/**
 * Utility class for resolving Copado Context variables and expressions.
 */
public inherited sharing class CopadoExpressionUtility {

    /**
     * Retrieves the Pipeline (Deployment Flow) ID dynamically based on a given context record ID.
     * Supported context objects: User Story Commit, Promotion, Test, and Job Execution.
     * 
     * @param contextId The ID of the record triggering the context.
     * @return The 18-character Pipeline ID, or an error string if not found.
     */
    public static String getPipelineId(Id contextId) {
        System.debug('Context Id: ' + contextId);
        if (contextId == null) {
            return 'Could not find pipeline id for context id: null';
        }

        String pipelineId;
        SObjectType sObjType = contextId.getSobjectType();

        if (sObjType == copado__User_Story_Commit__c.SObjectType) {
            copado__User_Story_Commit__c usc = [
                SELECT copado__User_Story__r.copado__Project__r.copado__Deployment_Flow__c
                FROM copado__User_Story_Commit__c
                WHERE Id = :contextId
                WITH USER_MODE
                LIMIT 1
            ];
            pipelineId = usc.copado__User_Story__r?.copado__Project__r?.copado__Deployment_Flow__c;

        } else if (sObjType == copado__Promotion__c.SObjectType) {
            copado__Promotion__c promo = [
                SELECT copado__Pipeline__c, 
                       copado__Project__r.copado__Deployment_Flow__c
                FROM copado__Promotion__c
                WHERE Id = :contextId
                WITH USER_MODE
                LIMIT 1
            ];
            // Fallback to Project's Pipeline if the direct Pipeline field is not populated
            pipelineId = promo.copado__Pipeline__c != null ? promo.copado__Pipeline__c : promo.copado__Project__r?.copado__Deployment_Flow__c;

        } else if (sObjType == copado__Test__c.SObjectType) {
            copado__Test__c testRec = [
                SELECT copado__User_Story__r.copado__Project__r.copado__Deployment_Flow__c
                FROM copado__Test__c
                WHERE Id = :contextId
                WITH USER_MODE
                LIMIT 1
            ];
            pipelineId = testRec.copado__User_Story__r?.copado__Project__r?.copado__Deployment_Flow__c;

        } else if (sObjType == copado__JobExecution__c.SObjectType) {
            copado__JobExecution__c je = [
                SELECT copado__Pipeline__c, copado__ParentRecord_Id__c
                FROM copado__JobExecution__c
                WHERE Id = :contextId
                WITH USER_MODE
                LIMIT 1
            ];
            
            if (je.copado__Pipeline__c != null) {
                pipelineId = je.copado__Pipeline__c;
            } else if (String.isNotBlank(je.copado__ParentRecord_Id__c)) {
                try {
                    Id parentId = (Id) je.copado__ParentRecord_Id__c;
                    return getPipelineId(parentId);
                } catch (Exception e) {
                    // Invalid ID format, will fall through to standard return below
                }
            }
        }

        return String.isNotBlank(pipelineId) ? pipelineId : null;
    }
}