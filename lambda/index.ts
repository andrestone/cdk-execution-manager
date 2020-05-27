// tslint:disable: no-console
import * as AWS from 'aws-sdk';
import * as map from './map';


/**
 * CDK CustomResource return props
 */
interface StateUpdate {
  /**
   * The Physical Resource ID we have to pass back to the provider framework
   */
  PhysicalResourceId: string,

  /**
   * The attributes as key-value pairs
   */
  Data: StateProps
}


/**
 * CDK CustomResource return Data property
 */
interface StateProps {
  /**
   * The attributes as key-value pairs
   */
  [name: string]: string
}


/**
 * Last known execution relevant state information
 */
interface TaskStates {

  /**
   * Last failed state
   */
  failedState: string,

  /**
   * Last succeeded state
   */
  succeededState: string,

  /**
   * The input to be passed when resuming execution.
   * It's the same input it was passed when the state failed, but with the `resumeTo` property pointing to the
   * last failed.
   */
  newInput: string,
}


async function runOrUpdate(event: AWSCDKAsyncCustomResource.OnEventRequest): Promise<AWSCDKAsyncCustomResource.OnEventResponse> {

  const sf = new AWS.StepFunctions();
  // Stateless
  const stateMachineArn = event.ResourceProperties[map.PROP_STATE_MACHINE_ARN];
  const startTime = event.ResourceProperties[map.PROP_START_TIME];
  const manualInput = event.ResourceProperties[map.PROP_EXEC_INPUT];

  // Stateful
  // Last execution
  const lastExecutions = await getLastExecution(stateMachineArn);
  if (typeof lastExecutions === "boolean") {
    return returnState({
      [map.ATTR_CURRENT_STATUS]: "EXECUTION_LIST_ERROR"
    })
  }
  const lastExecution = lastExecutions.length > 0 ? lastExecutions[0] : undefined;
  const lastExecutionStartTime = lastExecution?.startDate.toUTCString() || "";
  const lastExecutionArn = lastExecution?.executionArn || "";

  // Last execution history
  let lastExecHistory;
  let lastTaskStates: TaskStates | undefined;
  if (lastExecution) {
    lastExecHistory = await getExecutionHistory(lastExecution);
    if (typeof lastExecHistory === "boolean") {
      return returnState({
        [map.ATTR_CURRENT_STATUS]: "EXECUTION_HISTORY_ERROR"
      })
    } else {
      // Task States
      lastTaskStates = getTaskStates(lastExecHistory);
      if (manualInput) {
        lastTaskStates.newInput = JSON.parse(manualInput);
      }
    }
  }

  // Last Status
  const lastCurrentStatus = lastExecution?.status || "";
  const currentRunTime = Date.now();
  let ret: StateProps = {};

  // ----------------------
  // Event Handling Logic
  // ----------------------
  console.log(`manualInput: ${manualInput}\n`);
  console.log(`lastExecution: ${JSON.stringify(lastExecution)}\n`);
  console.log(`lastTaskStates: ${JSON.stringify(lastTaskStates)}\n`);
  if (event.RequestType.toLowerCase() === 'create' && Number(startTime) <= currentRunTime) {

    return await startExecution(manualInput);

  } else { // This is an update
    // Force restart execution from given state (resumeTo)
    if (manualInput) {
      return await startExecution(manualInput)
    }
    // This means we don't have any executions, we should try to trigger one
    if (!lastExecution) {

      return await startExecution(manualInput)

    } else {

      // There's a previous execution and we didn't pass any manualInput
      // The retry is going to happen with the input sent to the failed Task
      if (`"FAILED"|"TIMED_OUT"|"ABORTED"`.indexOf(lastExecution.status) !== -1 && lastTaskStates) {

        return await startExecution(lastTaskStates.newInput);

      } else { // RUNNING OR SUCCEEDED

        return returnState({}); // Will be updated with new values

      }
    }
  }

  /**
   * Retrieves the execution history of a single execution
   * @param execution
   */
  async function getExecutionHistory(execution: AWS.StepFunctions.ExecutionListItem): Promise<boolean | AWS.StepFunctions.GetExecutionHistoryOutput> {

    const executionHistory = await sf.getExecutionHistory({
      executionArn: execution.executionArn,
      maxResults: 1000,
      reverseOrder: true,
    }).promise();

    if (executionHistory.$response.error) {
      // Simply log the return, since this is out of the scope of the manager
      console.log(executionHistory.$response.error, executionHistory.$response.error.stack);
      return false

    } else {
      return executionHistory
    }

  }

  /**
   * Retrieves the last TaskStates and handles input for executions restart
   * @param executionHistory
   * @param targetState
   */
  function getTaskStates(executionHistory: AWS.StepFunctions.GetExecutionHistoryOutput, targetState?: string): TaskStates {
    console.log(`executionHistory: ${JSON.stringify(executionHistory)}\n`)
    let failedState = "";
    let succeededState = "";
    let failedStateInput: string | undefined = undefined;
    let targetStateInput: string | undefined = undefined;
    let event: AWS.StepFunctions.HistoryEvent;
    for (let i = 0; i < executionHistory.events.length; i++) {
      event = executionHistory.events[i];
      // If last execution succeeded, get output and return as input
      if (event.type === "ExecutionSucceeded") {
        succeededState = "__next__";
        continue;
      }
      if (succeededState === "__next__" && event.stateExitedEventDetails?.name) {
        succeededState = event.stateExitedEventDetails.name;
        break;
      }
      if (failedState === "__next__" && event.stateEnteredEventDetails) {
        failedState = event.stateEnteredEventDetails!.name;
        failedStateInput = event.stateEnteredEventDetails!.input;
      }
      // Trigger capturing next (after failure event) stateEntered event
      if (!failedState && (
        event.type.indexOf("Failed") !== -1 ||
        event.type.indexOf("Aborted") !== -1 ||
        event.type.indexOf("TimedOut") !== -1)) {
        failedState = "__next__";
      }
      // Trigger capturing next (after identifying the failed state) stateExisted event
      if (!!failedState && failedState !== "__next__" && (
        event.type.indexOf("Exited") !== -1)) {
        succeededState = event.stateExitedEventDetails!.name;
      }
      if (targetState) {
        if (event.stateEnteredEventDetails?.name === targetState) {
          targetStateInput = event.stateEnteredEventDetails.input;
        }
      }
    }

    // Adjusting the old input to the new input
    let newInput = JSON.parse(targetStateInput || failedStateInput || `{ "resumeTo": ""}`);
    newInput.resumeTo = targetState || failedState;
    return {failedState, succeededState, newInput}
  }

  /**
   * Retrieves that last execution. Empty object if no executions, false if error.
   * @param stateMachineArn
   */
  async function getLastExecution(stateMachineArn: string): Promise<boolean | AWS.StepFunctions.ExecutionList> {
    const lastExecutions = await sf.listExecutions({
      stateMachineArn,
      maxResults: 1 // Let's save some bandwidth
    }).promise();

    if (lastExecutions.$response.error) {
      // Simply log the return, since this is out of the scope of the manager
      console.log(lastExecutions.$response.error, lastExecutions.$response.error.stack);
      return false
    } else {
      return lastExecutions.executions
    }
  }

  /**
   * Starts an execution.
   * If passing an input, must contain resumeTo.
   *
   * @param input: must contain the property `resumeTo`
   */
  async function startExecution(input?: string) {
    if (input) {
      try {
        const inputObj = JSON.parse(input);
        if (Object.keys(inputObj).indexOf("resumeTo") < 0) {
          inputObj.resumeTo = "";
          input = JSON.stringify(inputObj);
        }
      } catch (e) {
        console.log(e);
        input = undefined;
      }
    }
    const startExecution = await sf.startExecution({
      stateMachineArn,
      name: `DeploymentManager-${event.RequestId}-${currentRunTime}`,
      input: input || `{ "resumeTo": ""}`
    }).promise();

    if (startExecution.$response.error) {
      console.log(startExecution.$response.error, startExecution.$response.error.stack);
      ret = {
        [map.ATTR_CURRENT_STATUS]: "EXECUTION_START_FAILED",
      }
    } else {
      ret = {
        [map.ATTR_LAST_EXECUTION_START_TIME]: currentRunTime.toString(),
        [map.ATTR_CURRENT_STATUS]: "EXECUTION_STARTED",
        [map.ATTR_LAST_EXECUTION_ARN]: startExecution.executionArn,
      };
    }
    // Return the attributes to CloudFormation
    // PhysicalResourceId is assigned to RequestId by default
    return returnState(ret)
  }

  function returnState(props: StateProps): StateUpdate {
    console.log("StateProps: " + JSON.stringify(props) + "\n")
    return {
      PhysicalResourceId: event.OldResourceProperties?.RequestId || event.RequestId,
      Data: {
        [map.ATTR_LAST_EXECUTION_START_TIME]: props[map.ATTR_LAST_EXECUTION_START_TIME] || lastExecutionStartTime || "",
        [map.ATTR_CURRENT_STATUS]: props[map.ATTR_CURRENT_STATUS] || lastCurrentStatus || "",
        [map.ATTR_TASK_STATES]: props[map.ATTR_TASK_STATES] || JSON.stringify(lastTaskStates) || "",
        [map.ATTR_LAST_EXECUTION_ARN]: props[map.ATTR_LAST_EXECUTION_ARN] || lastExecutionArn || "",
      }
    }
  }
}

async function deleteResource(event: AWSCDKAsyncCustomResource.OnEventRequest) {
  // It looks like there's nothing to do here
}

export async function onEvent(event: AWSCDKAsyncCustomResource.OnEventRequest) {
  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      return runOrUpdate(event);
    case 'Delete':
      return await deleteResource(event);
  }
}