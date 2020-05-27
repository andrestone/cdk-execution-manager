import * as cdk from '@aws-cdk/core';
import * as sf from '@aws-cdk/aws-stepfunctions';
import * as cfn from '@aws-cdk/aws-cloudformation';
import DeploymentManagerProvider from "./provider";
import * as map from "../lambda/map";


/**
 * We must receive a formal request for when to run the deployment State Machine execution
 * and the state machine itself.
 *
 */
interface DeploymentManagerProps {
    /**
     * When to start the first deployment execution attempt. (e.g. Date.now())
     *
     */
    readonly startTime?: Date;

    /**
     * The Chain of States that represents a State Machine definition
     */
    readonly stateMachineDefinition: sf.Chain;

    /**
     * Execution input. Must contain `resumeTo` property
     */
    readonly executionInput?: inputProps;

}

interface inputProps {
    /**
     * The state to resume to.
     *
     */
    readonly resumeTo?: string;

    /**
     * Other inputs
     *
     */
    readonly [name: string]: string | undefined;
}


export class DeploymentManager extends cdk.Construct {
    public readonly currentStatus: string;
    public readonly taskStates: string;
    public readonly lastExecutionArn: string;
    public readonly lastExecutionStartTime: string;
    public readonly resource: cfn.CustomResource;

    private static getOrCreateStateMachine(scope: cdk.Construct, definition: sf.IChainable): sf.StateMachine {
        const stack = cdk.Stack.of(scope);
        const uid = "com.giss.aws-stepfunctions.deploymentmanager-statemachine";
        const exists = stack.node.tryFindChild(uid);
        //If it already exists, we just return ir right here
        if (exists) {
            return exists as sf.StateMachine;
        }
        // Building a set of States
        const states = new Set<sf.State>();

        // First element of the chain
        states.add(definition.startState);

        // Subsequent elements (made a RFC, waiting green light to do PR)
        sf.State.findReachableStates(definition.startState).forEach(state => {
            states.add(state);
        });

        // Here we add our ResumeTo logic to the top of the chain
        const choices = new sf.Choice(scope, "ResumeTo");

        let statesArray = Array.from(states);

        for (let i = 0; i < statesArray.length; i++) {
            choices.when(sf.Condition.stringEquals('$.resumeTo', statesArray[i].id), statesArray[i]);
        }
        // states.forEach(state => {
        //     choices.when(sf.Condition.stringEquals('$.resumeTo', state.id), state);
        // });
        choices.otherwise(definition);

        return new sf.StateMachine(stack, uid, {
            definition: choices,
            stateMachineName: `DeploymentManager-${stack.node.id}`
        })
    }

    constructor(scope: cdk.Construct, id: string, props: DeploymentManagerProps) {
        super(scope, id);

        const provider =  DeploymentManagerProvider.getOrCreate(this);
        
        const customResourceProps: {[index: string]: string | undefined} = {};

        //Stateless
        customResourceProps[map.PROP_START_TIME]= props.startTime?.valueOf().toString() || Date.now().toString();
        customResourceProps[map.PROP_EXEC_INPUT]= JSON.stringify(props.executionInput);
        customResourceProps[map.PROP_STATE_MACHINE_ARN]= DeploymentManager.getOrCreateStateMachine(this, props.stateMachineDefinition).stateMachineArn;
        // Now we ensure we trigger the update
        customResourceProps[map.PROP_LAST_CFN_UPDATE]= Date.now().toFixed(0).toString();

        this.resource = new cfn.CustomResource(this, 'DeploymentManager', {
            provider: provider,
            resourceType: 'Custom::DeploymentManager',
            properties: customResourceProps
        });

        // These are used by those Tokens above
        this.currentStatus = this.resource.getAttString(map.ATTR_CURRENT_STATUS);
        this.taskStates = this.resource.getAttString(map.ATTR_TASK_STATES);
        this.lastExecutionArn = this.resource.getAttString(map.ATTR_LAST_EXECUTION_ARN);
        this.lastExecutionStartTime = this.resource.getAttString(map.ATTR_LAST_EXECUTION_START_TIME);

        new cdk.CfnOutput(this, "TaskStates", {
            value: JSON.stringify(this.taskStates)
        });
        new cdk.CfnOutput(this, "CurrentStatus", {
            value: this.currentStatus
        });
        new cdk.CfnOutput(this, "LinkToConsole", {
            exportName: "exportName",
            description: "description",
            value: `https://console.aws.amazon.com/states/home?region=${
                cdk.Stack.of(this).region
            }#/executions/details/${
                this.lastExecutionArn 
            }`
        });
    }
}


