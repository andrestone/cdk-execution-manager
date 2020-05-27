import * as cdk from "@aws-cdk/core";
import * as cr from "@aws-cdk/custom-resources";
import * as path from "path";
import * as lambda from "@aws-cdk/aws-lambda";
import * as iam from "@aws-cdk/aws-iam";


export default class DeploymentManagerProvider extends cdk.Construct {

    /**
     * Returns the singleton provider.
     */
    public static getOrCreate(scope: cdk.Construct) {
        const stack = cdk.Stack.of(scope);
        const id = 'com.giss.custom-resources.deploymentmanager-provider';
        const x = stack.node.tryFindChild(id) as DeploymentManagerProvider || new DeploymentManagerProvider(stack, id);
        return x.provider;
    }

    private readonly provider: cr.Provider;

    constructor(scope: cdk.Construct, id: string) {
        super(scope, id);

        const policyStatement = new iam.PolicyStatement({
            resources: [ "arn:aws:states:*:*:stateMachine:DeploymentManager*",
                "arn:aws:states:*:*:execution:*:DeploymentManager*"],
            actions: [
                "states:DescribeStateMachine",
                "states:StartExecution",
                "states:DeleteStateMachine",
                "states:ListExecutions",
                "states:UpdateStateMachine",
                "states:DescribeExecution",
                "states:DescribeStateMachineForExecution",
                "states:GetExecutionHistory",
                "states:StopExecution"
            ]
        });
        this.provider = new cr.Provider(this, id, {
            onEventHandler: new lambda.Function(this, 'deployment-on-event', {
                code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
                runtime: lambda.Runtime.NODEJS_10_X,
                handler: 'index.onEvent',
                initialPolicy: [
                    policyStatement
                ]
            }),
        });
    }
}