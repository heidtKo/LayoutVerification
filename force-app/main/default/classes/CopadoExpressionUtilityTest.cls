@IsTest
private class CopadoExpressionUtilityTest {
    private static CopadoTestUtility ctu;
    private static CopadoTestUserService ctus;
    private static CopadoTestPermissionService ctps;

    private static final String NULL_CONTEXT_MESSAGE = 'Could not find pipeline id for context id: null';

    /**
     * overall notes:
     * Same pattern as CopadoSampleTestClass.
     * 1. @TestSetup builds the static prerequisites (user, licenses, environments, credentials for BOTH environments,
     *    repository, snapshot, active pipeline with a step, project).
     * 2. Each test method creates the context records it needs (user story, commits, promotion, test, job execution)
     *    inside Test.startTest/stopTest, which gives a fresh governor limit context.
     * 3. Everything runs as the running user, so WITH USER_MODE in CopadoExpressionUtility is exercised realistically.
     */

    @TestSetup
    static void makeData() {
        System.debug('Start Test Class Setup');
        ctu = new CopadoTestUtility();
        ctus = new CopadoTestUserService();
        ctps = new CopadoTestPermissionService();
        CopadoTestDataFactory.ctus = ctus;

        // Create Admin User
        User adminUser = CopadoTestDataFactory.createAdminUser();
        insert adminUser;

        System.runAs(adminUser) {
            // Create Running User
            User runningUser = CopadoTestDataFactory.createStandardUser();
            runningUser.ProfileId = adminUser.ProfileId;
            runningUser.Username = 'runningUser' + DateTime.now().getTime() + Math.abs(Crypto.getRandomInteger()) + '@copadoTestClass.com.test';
            insert runningUser;

            // Get Licenses & PermSets
            Map<Id,PermissionSet> permSets = ctps.getAllCopadoPermissionSets();
            Map<Id,PackageLicense> packageLicenses = ctps.getCopadoPackageLicenses();

            // Assign package licenses
            Database.insert(
                ctps.assignPackagesToUsers(new Set<Id>{runningUser.Id}, packageLicenses.keySet(), null)
            );

            // Assign permission sets
            Database.insert(
                ctps.assignPermissionSetsToUsers(new Set<Id>{runningUser.Id}, permSets.keySet(), null)
            );

            // Assign Copado License
            ctu.assignLicenseForTestRun(runningUser.Id);

            System.runAs(runningUser) {
                // Create Environments
                String currentOrgId = UserInfo.getOrganizationId();
                copado__Environment__c sourceEnv = CopadoTestDataFactory.createEnvironment('Source', '');
                copado__Environment__c targetEnv = CopadoTestDataFactory.createEnvironment('Target', '');
                insert new List<copado__Environment__c>{sourceEnv, targetEnv};

                // Create Credentials (one per environment, the promotion needs a credential for the destination)
                copado__Org__c sourceOrgCredential = CopadoTestDataFactory.createOrgCredential(sourceEnv, currentOrgId.left(15) + 'ABC');
                sourceOrgCredential.Name = 'sourceCred';
                copado__Org__c targetOrgCredential = CopadoTestDataFactory.createOrgCredential(targetEnv, currentOrgId.left(15) + 'DEF');
                targetOrgCredential.Name = 'targetCred';
                insert new List<copado__Org__c>{sourceOrgCredential, targetOrgCredential};

                // Create Git Repository
                copado__Git_Repository__c repo = CopadoTestDataFactory.createGitRepo();
                insert repo;

                // Create Git Backup
                copado__Git_Backup__c snapshot = CopadoTestDataFactory.createGitSnapshot(sourceOrgCredential, repo, 'dev1');
                insert snapshot;

                // Create Deployment Flow (inserted inactive, then activated)
                copado__Deployment_Flow__c flow = CopadoTestDataFactory.createDeploymentFlow(repo);
                flow.copado__Active__c = false;
                insert flow;
                flow.copado__Active__c = true;
                update flow;

                // Create Deployment Flow Step
                copado__Deployment_Flow_Step__c dfs = CopadoTestDataFactory.createDeploymentFlowStep(flow.Id, sourceEnv.Id, targetEnv.Id);
                insert dfs;

                // Create Project
                copado__Project__c project = CopadoTestDataFactory.createProject(flow);
                if (CopadoTestDataFactory.hasCopadoIntegration) {
                    SObject setting = CopadoTestDataFactory.createIntegrationSetting();
                    Database.insert(setting);
                    project = CopadoTestDataFactory.addIntegrationSetting(project, (String) setting.Id);
                }
                insert project;
            }
        }
    }

    // ------------------------------------------------------------------
    // Null context
    // ------------------------------------------------------------------

    @IsTest
    static void testNullContext() {
        System.runAs(getRunningUser()) {
            Test.startTest();
            String result = CopadoExpressionUtility.getPipelineId(null);
            Test.stopTest();

            System.assertEquals(NULL_CONTEXT_MESSAGE, result, 'A null context must return the null context message');
        }
    }

    // ------------------------------------------------------------------
    // User Story Commit
    // ------------------------------------------------------------------

    @IsTest
    static void testUserStoryCommitContext() {
        System.runAs(getRunningUser()) {
            copado__Deployment_Flow__c flow = getFlow();

            Test.startTest();
            copado__User_Story__c userStory = createUserStory();
            copado__User_Story_Commit__c usc = createUserStoryCommit(userStory);

            String result = CopadoExpressionUtility.getPipelineId(usc.Id);
            Test.stopTest();

            System.assertEquals(String.valueOf(flow.Id), result, 'User Story Commit must resolve to the project pipeline');
        }
    }

    // ------------------------------------------------------------------
    // Promotion
    // ------------------------------------------------------------------

    @IsTest
    static void testPromotionContext() {
        System.runAs(getRunningUser()) {
            copado__Deployment_Flow__c flow = getFlow();

            Test.startTest();
            copado__Promotion__c promotion = createPromotion();

            String result = CopadoExpressionUtility.getPipelineId(promotion.Id);
            Test.stopTest();

            // Resolves through promotion.copado__Pipeline__c or, as fallback, the project's Deployment Flow.
            System.assertEquals(String.valueOf(flow.Id), result, 'Promotion must resolve to the pipeline');
        }
    }

    // ------------------------------------------------------------------
    // Test
    // ------------------------------------------------------------------

    @IsTest
    static void testTestContext() {
        System.runAs(getRunningUser()) {
            copado__Deployment_Flow__c flow = getFlow();

            Test.startTest();
            copado__User_Story__c userStory = createUserStory();
            copado__Test__c testRecord = new copado__Test__c(
                Name = 'Sample Test',
                copado__User_Story__c = userStory.Id
            );
            insert testRecord;

            String result = CopadoExpressionUtility.getPipelineId(testRecord.Id);
            Test.stopTest();

            System.assertEquals(String.valueOf(flow.Id), result, 'Test must resolve to the pipeline of its user story project');
        }
    }

    // ------------------------------------------------------------------
    // Job Execution
    // ------------------------------------------------------------------

    @IsTest
    static void testJobExecutionWithDirectPipeline() {
        System.runAs(getRunningUser()) {
            copado__Deployment_Flow__c flow = getFlow();

            Test.startTest();
            copado__JobExecution__c jobExecution = new copado__JobExecution__c(
                copado__Pipeline__c = flow.Id
            );
            insert jobExecution;

            String result = CopadoExpressionUtility.getPipelineId(jobExecution.Id);
            Test.stopTest();

            System.assertEquals(String.valueOf(flow.Id), result, 'Job Execution with its own pipeline must return that pipeline');
        }
    }

    @IsTest
    static void testJobExecutionWithPromotionParent() {
        System.runAs(getRunningUser()) {
            copado__Deployment_Flow__c flow = getFlow();

            Test.startTest();
            copado__Promotion__c promotion = createPromotion();
            copado__JobExecution__c jobExecution = new copado__JobExecution__c(
                copado__ParentRecord_Id__c = promotion.Id
            );
            insert jobExecution;

            String result = CopadoExpressionUtility.getPipelineId(jobExecution.Id);
            Test.stopTest();

            System.assertEquals(String.valueOf(flow.Id), result, 'Job Execution must recurse into its parent promotion');
        }
    }

    @IsTest
    static void testJobExecutionWithJobExecutionParent() {
        System.runAs(getRunningUser()) {
            copado__Deployment_Flow__c flow = getFlow();

            Test.startTest();
            copado__JobExecution__c parentExecution = new copado__JobExecution__c(
                copado__Pipeline__c = flow.Id
            );
            insert parentExecution;

            copado__JobExecution__c childExecution = new copado__JobExecution__c(
                copado__ParentRecord_Id__c = parentExecution.Id
            );
            insert childExecution;

            String result = CopadoExpressionUtility.getPipelineId(childExecution.Id);
            Test.stopTest();

            System.assertEquals(String.valueOf(flow.Id), result, 'Job Execution must recurse through nested job executions');
        }
    }

    @IsTest
    static void testJobExecutionWithInvalidParentId() {
        System.runAs(getRunningUser()) {
            Test.startTest();
            copado__JobExecution__c jobExecution = new copado__JobExecution__c(
                copado__ParentRecord_Id__c = 'this is not an id'
            );
            insert jobExecution;

            String result = CopadoExpressionUtility.getPipelineId(jobExecution.Id);
            Test.stopTest();

            System.assertEquals(null, result, 'An invalid parent id must be swallowed and return null');
        }
    }

    @IsTest
    static void testJobExecutionWithoutPipelineAndParent() {
        System.runAs(getRunningUser()) {
            Test.startTest();
            copado__JobExecution__c jobExecution = new copado__JobExecution__c();
            insert jobExecution;

            String result = CopadoExpressionUtility.getPipelineId(jobExecution.Id);
            Test.stopTest();

            System.assertEquals(null, result, 'A job execution without pipeline and parent must return null');
        }
    }

    // ------------------------------------------------------------------
    // Unsupported object
    // ------------------------------------------------------------------

    @IsTest
    static void testUnsupportedObjectContext() {
        System.runAs(getRunningUser()) {
            Test.startTest();
            Account acct = CopadoTestDataFactory.createAccount('Unsupported Context');
            insert acct;

            String result = CopadoExpressionUtility.getPipelineId(acct.Id);
            Test.stopTest();

            // The utility has no branch for Account, so pipelineId stays blank and null is returned.
            System.assertEquals(null, result, 'An unsupported object type must return null');
        }
    }

    // ------------------------------------------------------------------
    // Helpers (always call them inside System.runAs(getRunningUser()))
    // ------------------------------------------------------------------

    private static User getRunningUser() {
        return [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];
    }

    private static copado__Deployment_Flow__c getFlow() {
        return [SELECT Id, Name FROM copado__Deployment_Flow__c LIMIT 1];
    }

    private static copado__User_Story__c createUserStory() {
        copado__Project__c project = [SELECT Id, Name FROM copado__Project__c LIMIT 1];
        copado__Environment__c sourceEnvironment = [SELECT Id, Name FROM copado__Environment__c WHERE Name = 'Source' LIMIT 1];
        copado__Org__c sourceCredential = [SELECT Id, Name FROM copado__Org__c WHERE Name = 'sourceCred' LIMIT 1];

        copado__User_Story__c userStory = CopadoTestDataFactory.createUserStory(project, sourceEnvironment, sourceCredential);
        insert userStory;

        List<copado__User_Story_Metadata__c> usmList = CopadoTestDataFactory.createSampleMetadataForStory(userStory.Id);
        insert usmList;

        return userStory;
    }

    private static copado__User_Story_Commit__c createUserStoryCommit(copado__User_Story__c userStory) {
        copado__Org__c sourceCredential = [SELECT Id, Name FROM copado__Org__c WHERE Name = 'sourceCred' LIMIT 1];
        copado__Git_Backup__c snapshot = [SELECT Id, Name FROM copado__Git_Backup__c WHERE copado__Branch__c = 'dev1' LIMIT 1];

        copado__Git_Org_Commit__c snapshotCommit = CopadoTestDataFactory.createSnapshotCommit(sourceCredential, snapshot, 'Complete');
        insert snapshotCommit;

        copado__User_Story_Commit__c usc = CopadoTestDataFactory.createUserStoryCommit(userStory, snapshotCommit);
        insert usc;

        return usc;
    }

    private static copado__Promotion__c createPromotion() {
        copado__Project__c project = [SELECT Id, Name FROM copado__Project__c LIMIT 1];
        copado__Environment__c sourceEnvironment = [SELECT Id, Name FROM copado__Environment__c WHERE Name = 'Source' LIMIT 1];
        copado__Environment__c targetEnvironment = [SELECT Id, Name FROM copado__Environment__c WHERE Name = 'Target' LIMIT 1];

        copado__Promotion__c promotion = CopadoTestDataFactory.createForwardPromotion(project.Id, sourceEnvironment.Id, targetEnvironment.Id);
        insert promotion;

        return promotion;
    }
}
