@IsTest
private class LayoutValidationDetailsExpressionTest {
    private static CopadoTestUtility ctu;
    private static CopadoTestUserService ctus;
    private static CopadoTestPermissionService ctps;

    private static final String TOOL_NAME = 'Layout Validation';
    private static final String FALLBACK_DETAILS = '{"pipeline": "fakeId123"}';

    /**
     * overall notes:
     * Copado related logic must run as a non-admin running user with Copado permission sets and licenses.
     * Shared prerequisites are created in @TestSetup. Test specific records are created inside
     * Test.startTest/stopTest to get a fresh governor limit context and avoid SOQL limit issues.
     * copado__ExtensionConfiguration__c requires copado__ExtensionApplication__c. The factory populates it,
     * so the tests do not need to know how that field is modeled.
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
            Map<Id, PermissionSet> permSets = ctps.getAllCopadoPermissionSets();
            Map<Id, PackageLicense> packageLicenses = ctps.getCopadoPackageLicenses();

            // Assign package licenses
            Database.insert(
                ctps.assignPackagesToUsers(new Set<Id>{ runningUser.Id }, packageLicenses.keySet(), null)
            );

            // Assign permission sets
            Database.insert(
                ctps.assignPermissionSetsToUsers(new Set<Id>{ runningUser.Id }, permSets.keySet(), null)
            );

            // Assign Copado License
            ctu.assignLicenseForTestRun(runningUser.Id);

            System.runAs(runningUser) {
                // Create Environments
                String currentOrgId = UserInfo.getOrganizationId();
                copado__Environment__c sourceEnv = CopadoTestDataFactory.createEnvironment('Source', '');
                copado__Environment__c targetEnv = CopadoTestDataFactory.createEnvironment('Target', '');
                insert new List<copado__Environment__c>{ sourceEnv, targetEnv };

                // Create Credentials
                copado__Org__c sourceOrgCredential = CopadoTestDataFactory.createOrgCredential(sourceEnv, currentOrgId.left(15) + 'ABC');
                sourceOrgCredential.Name = 'sourceCred';
                copado__Org__c targetOrgCredential = CopadoTestDataFactory.createOrgCredential(targetEnv, currentOrgId.left(15) + 'DEF');
                targetOrgCredential.Name = 'targetCred';
                insert new List<copado__Org__c>{ sourceOrgCredential, targetOrgCredential };

                // Create Git Repository
                copado__Git_Repository__c repo = CopadoTestDataFactory.createGitRepo();
                insert repo;

                // Create Git Backup
                copado__Git_Backup__c snapshot = CopadoTestDataFactory.createGitSnapshot(sourceOrgCredential, repo, 'dev1');
                insert snapshot;

                // Create Deployment Flow (pipeline)
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

                // Create Promotion (context record)
                copado__Promotion__c promo = CopadoTestDataFactory.createForwardPromotion(project.Id, sourceEnv.Id, targetEnv.Id);
                insert promo;

                // Create Extension Configurations (one mapped to the pipeline, one not)
                copado__ExtensionConfiguration__c extConfig1 = CopadoTestDataFactory.createExtensionConfiguration(
                    'Layout Validation Test 1',
                    TOOL_NAME,
                    true,
                    '{"pipeline": "' + flow.Id + '", "key": "value"}'
                );
                copado__ExtensionConfiguration__c extConfig2 = CopadoTestDataFactory.createExtensionConfiguration(
                    'Layout Validation Test 2',
                    TOOL_NAME,
                    true,
                    FALLBACK_DETAILS
                );
                insert new List<copado__ExtensionConfiguration__c>{ extConfig1, extConfig2 };
            }
        }
    }

    /**
     * Promotion context resolves the pipeline. The config for the pipeline must be returned,
     * even though another config sorts first (Name DESC).
     */
    @IsTest
    static void testExecuteWithValidPipeline() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            copado__Promotion__c promo = [SELECT Id FROM copado__Promotion__c LIMIT 1];
            copado__Deployment_Flow__c flow = [SELECT Id FROM copado__Deployment_Flow__c LIMIT 1];

            Test.startTest();
            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(promo.Id);
            Test.stopTest();

            System.assert(String.isNotBlank(result), 'Result should not be empty');
            System.assert(result.contains((String) flow.Id), 'Result should contain the correct pipeline ID details');
            System.assertNotEquals(FALLBACK_DETAILS, result, 'Config of another pipeline must not be returned');
        }
    }

    /**
     * User Story Commit context resolves the pipeline via User Story > Project > Pipeline.
     * Prerequisites are created inside Test.startTest to get a fresh governor limit context.
     */
    @IsTest
    static void testExecuteWithUserStoryCommitContext() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            copado__Org__c sourceCredential = [SELECT Id, Name FROM copado__Org__c WHERE Name = 'sourceCred' LIMIT 1];
            copado__Environment__c sourceEnvironment = [SELECT Id, Name FROM copado__Environment__c WHERE Name = 'Source' LIMIT 1];
            copado__Project__c project = [SELECT Id, Name FROM copado__Project__c LIMIT 1];
            copado__Git_Backup__c snapshot = [SELECT Id, Name FROM copado__Git_Backup__c WHERE copado__Branch__c = 'dev1' LIMIT 1];
            copado__Deployment_Flow__c flow = [SELECT Id FROM copado__Deployment_Flow__c LIMIT 1];

            Test.startTest();
            copado__User_Story__c userStory = CopadoTestDataFactory.createUserStory(project, sourceEnvironment, sourceCredential);
            insert userStory;

            copado__Git_Org_Commit__c snapshotCommit = CopadoTestDataFactory.createSnapshotCommit(sourceCredential, snapshot, 'Complete');
            insert snapshotCommit;

            copado__User_Story_Commit__c usc = CopadoTestDataFactory.createUserStoryCommit(userStory, snapshotCommit);
            insert usc;

            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(usc.Id);
            Test.stopTest();

            System.assert(String.isNotBlank(result), 'Result should not be empty');
            System.assert(result.contains((String) flow.Id), 'Result should contain the pipeline ID resolved from the user story commit');
        }
    }

    /**
     * Unsupported context object: the utility returns null, so the class falls back to the most
     * recently modified active config (LastModifiedDate DESC, Name DESC).
     */
    @IsTest
    static void testExecuteWithFallback() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            // Account Id prefix is not handled by the utility, so pipelineId is null
            Id dummyId = '001000000000000AAA';

            Test.startTest();
            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(dummyId);
            Test.stopTest();

            System.assertEquals(FALLBACK_DETAILS, result, 'Result should fall back to the first active config in sort order');
        }
    }

    /**
     * Null context: the utility returns a non-null error string, so no config can match it.
     */
    @IsTest
    static void testExecuteWithNullContext() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            Test.startTest();
            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(null);
            Test.stopTest();

            System.assertEquals('', result, 'Null context should not match any config and return an empty string');
        }
    }

    /**
     * Pipeline is resolved, but no active config references it. Result must be an empty string.
     */
    @IsTest
    static void testExecuteWithPipelineNotMatchingAnyConfig() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            copado__Promotion__c promo = [SELECT Id FROM copado__Promotion__c LIMIT 1];
            updateActiveConfigDetails(FALLBACK_DETAILS);

            Test.startTest();
            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(promo.Id);
            Test.stopTest();

            System.assertEquals('', result, 'Result should be empty when no config references the pipeline');
        }
    }

    /**
     * Configs with blank details are skipped when a pipeline is resolved.
     */
    @IsTest
    static void testExecuteWithBlankDetails() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            copado__Promotion__c promo = [SELECT Id FROM copado__Promotion__c LIMIT 1];
            updateActiveConfigDetails(null);

            Test.startTest();
            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(promo.Id);
            Test.stopTest();

            System.assertEquals('', result, 'Configs with blank details should be skipped');
        }
    }

    /**
     * Inactive configs must be ignored, even if they sort first and reference the pipeline.
     */
    @IsTest
    static void testExecuteIgnoresInactiveConfigs() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            copado__Promotion__c promo = [SELECT Id FROM copado__Promotion__c LIMIT 1];
            copado__Deployment_Flow__c flow = [SELECT Id FROM copado__Deployment_Flow__c LIMIT 1];

            Test.startTest();
            copado__ExtensionConfiguration__c inactiveConfig = CopadoTestDataFactory.createExtensionConfiguration(
                'Layout Validation Test 9',
                TOOL_NAME,
                false,
                '{"pipeline": "' + flow.Id + '", "inactive": true}'
            );
            insert inactiveConfig;

            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String result = expr.execute(promo.Id);
            Test.stopTest();

            System.assert(String.isNotBlank(result), 'Result should not be empty');
            System.assert(!result.contains('inactive'), 'Inactive config must not be returned');
            System.assert(result.contains((String) flow.Id), 'Active config for the pipeline should be returned');
        }
    }

    /**
     * No active configs at all: with and without a resolvable pipeline the result is an empty string.
     */
    @IsTest
    static void testExecuteWithNoConfigs() {
        User runningUser = [SELECT Id FROM User WHERE Username LIKE 'runningUser%' LIMIT 1];

        System.runAs(runningUser) {
            // Active configs cannot be deleted, so deactivate them first
            List<copado__ExtensionConfiguration__c> configs = [
                SELECT Id, copado__Active__c FROM copado__ExtensionConfiguration__c
            ];
            for (copado__ExtensionConfiguration__c config : configs) {
                config.copado__Active__c = false;
            }
            update configs;
            delete configs;

            copado__Promotion__c promo = [SELECT Id FROM copado__Promotion__c LIMIT 1];
            Id dummyId = '001000000000000AAA';

            Test.startTest();
            LayoutValidationDetailsExpression expr = new LayoutValidationDetailsExpression();
            String resultWithPipeline = expr.execute(promo.Id);
            String resultWithoutPipeline = expr.execute(dummyId);
            Test.stopTest();

            System.assertEquals('', resultWithPipeline, 'Result should be a safe empty string when no configs exist (pipeline resolved)');
            System.assertEquals('', resultWithoutPipeline, 'Result should be a safe empty string when no configs exist (no pipeline)');
        }
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * Active configurations may be locked for edits, so deactivate, change the details, then reactivate.
     */
    private static void updateActiveConfigDetails(String newDetails) {
        List<copado__ExtensionConfiguration__c> configs = [
            SELECT Id, copado__Details__c, copado__Active__c FROM copado__ExtensionConfiguration__c
        ];
        for (copado__ExtensionConfiguration__c config : configs) {
            config.copado__Active__c = false;
        }
        update configs;

        for (copado__ExtensionConfiguration__c config : configs) {
            config.copado__Details__c = newDetails;
            config.copado__Active__c = true;
        }
        update configs;
    }
}
