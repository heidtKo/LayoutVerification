/**
Dynamic expression class for the Layout Validation quality tool.
Returns the raw copado__Details__c value of the most recently modified
Extension Configuration that belongs to the Layout Validation tool.
Usage in a function parameter:
{$Context.Apex.LayoutValidationDetailsExpression}
The context Id (job step Id, source Id or destination Id) is not needed
to resolve the value, so it is intentionally ignored.
*/

@SuppressWarnings('PMD.AvoidGlobalModifier')
global with sharing class LayoutValidationDetailsExpression implements copado.ParameterExpressionCallable {

    private static final String TOOL_NAME = 'Layout Validation';
    
    global LayoutValidationDetailsExpression() {}

    global String execute(Id contextId) {
        System.debug('Context Id: ' + (String) contextId);

        String pipelineId = CopadoExpressionUtility.getPipelineId(contextId);
        if(pipelineId==null){
            System.debug('pipeline id could not be found. utility is not working as expected for context id ' + contextId);
        } else{
            System.debug(pipelineId);
        }

        List<copado__ExtensionConfiguration__c> configs = new List<copado__ExtensionConfiguration__c>([
            SELECT Id, copado__Details__c
            FROM copado__ExtensionConfiguration__c
            WHERE copado__ExtensionTool__c = :TOOL_NAME 
            AND copado__Active__c = true
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC, Name DESC
            LIMIT 100
        ]);
        
        if(pipelineId != null){
            for (copado__ExtensionConfiguration__c config : configs) {
                System.debug('extension Config id: ' + config.id);
                if (
                    String.isNotBlank(config.copado__Details__c) && 
                    config.copado__Details__c.contains(pipelineId)     
                ) {
                    return config.copado__Details__c;
                }
            }
        } else{
            if (!configs.isEmpty()) {
                return (String) configs[0].copado__Details__c;
            }
        }
        
        return '';
    }
}