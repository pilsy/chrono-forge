/*
Complete List of Conditions
Comparison Conditions: Equals, NotEquals, GreaterThan, LessThan, GreaterThanOrEquals, LessThanOrEquals.
Logical Conditions: And, Or, Not.
State-Based Conditions: Checks against current state values (StateEquals, StateNotEquals).
Time-Based Conditions: BeforeTime, AfterTime, WithinTimeRange.
Error Conditions: Conditions based on error states (OnError, OnSuccess).
Custom Conditions: User-defined conditions evaluated via JavaScript functions.
*/

type Condition = ComparisonCondition | LogicalCondition | StateBasedCondition | TimeBasedCondition | ErrorCondition | CustomCondition;

type ComparisonCondition =
  | { type: 'Equals'; left: any; right: any }
  | { type: 'NotEquals'; left: any; right: any }
  | { type: 'GreaterThan'; left: any; right: any }
  | { type: 'LessThan'; left: any; right: any }
  | { type: 'GreaterThanOrEquals'; left: any; right: any }
  | { type: 'LessThanOrEquals'; left: any; right: any };

type LogicalCondition =
  | { type: 'And'; conditions: Condition[] }
  | { type: 'Or'; conditions: Condition[] }
  | { type: 'Not'; condition: Condition };

type StateBasedCondition = { type: 'StateEquals'; path: string; value: any } | { type: 'StateNotEquals'; path: string; value: any };

type TimeBasedCondition =
  | { type: 'BeforeTime'; time: Date }
  | { type: 'AfterTime'; time: Date }
  | { type: 'WithinTimeRange'; startTime: Date; endTime: Date };

type ErrorCondition = { type: 'OnError'; errorType?: string } | { type: 'OnSuccess' };

type CustomCondition = {
  type: 'Custom';
  evaluate: (bindings: Record<string, any>) => boolean;
};
