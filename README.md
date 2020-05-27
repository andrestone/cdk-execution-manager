This CDK construct takes a State Machine and the state input as `props` and creates a CloudFormation Custom Resource to manage executions in a Lambda function. It also adds a `ResumeTo` state, at the top of the StateMachine tree, so executions can be easily resumed to a certain state. At each `cdk deploy` a new execution is triggered and the CDK cli outputs the URL for the triggered execution details. 

![State Machine](https://dev-to-uploads.s3.amazonaws.com/i/al760ondl1l0q16bw7tw.png)

## Usage:

Install:

`npm install cdk-execution-manager`


```typescript
import * as sfn from '@aws-cdk/aws-stepfunctions'
import { DeploymentManager } from "cdk-deployment-manager";

const task1 = new stepfunctions.Pass(stack, 'State One');
const task2 = new stepfunctions.Pass(stack, 'State Two');
const stateMachine = task1.next(task2);

new DeploymentManager(this, "TestDeployment", {
      stateMachineDefinition: definition,
    });
```

Every time you run `cdk deploy` a new execution will be triggered, the cli will output a link to the current execution.

 ![Deployment Manager output](https://dev-to-uploads.s3.amazonaws.com/i/vpayaicceq6hliikxo51.png)
 
You can pass inputs using the `executionInput` property:
 
 ```typescript
new DeploymentManager(this, "TestDeployment", {
      stateMachineDefinition: definition,
      executionInput: {
              payload: `PAYLOAD`,
            },
    });
```
 
You can use the `resumeTo` input path to resume the execution from a given state:

```typescript
new DeploymentManager(this, "TestDeployment", {
      stateMachineDefinition: definition,
      executionInput: {
              payload: `PAYLOAD`,
              resumeTo: task2.id,
            },
    });
```

## LICENSE

MIT