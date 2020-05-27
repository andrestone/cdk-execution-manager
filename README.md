This CDK construct takes a State Machine and the state input as `props` and creates a CloudFormation Custom Resource to manage executions in a Lambda function. It also adds a `ResumeTo` state, at the top of the StateMachine tree, so executions can be easily resumed to a certain state. At each `cdk deploy` a new execution is triggered and the CDK cli outputs the URL for the triggered execution details. 

![State Machine](https://dev-to-uploads.s3.amazonaws.com/i/al760ondl1l0q16bw7tw.png)

