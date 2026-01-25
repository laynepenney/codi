# Phase 5: Interactive Features - Enhanced Documentation

## Overview
Phase 5 introduces comprehensive interactive features allowing workflows to pause execution and gather user input at specific points.

## Interactive Step Properties

### Basic Properties
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `action` | `"interactive"` | Yes | Identifies the step type |
| `prompt` | `string` | Yes | Text displayed to the user |
| `description` | `string` | No | Human-readable description |

### Enhanced Properties
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `inputType` | `text|password|confirm|choice|multiline` | `text` | Controls input widget |
| `timeoutMs` | `number` | `0` | Timeout in milliseconds (0 = no timeout) |
| `defaultValue` | `string` | `""` | Default value if user provides none |
| `validationPattern` | `string` | `""` | Regex pattern for input validation |
| `choices` | `string[]` | `[]` | Valid options for `choice` input type |

## Input Types

### Text (`text`)
Standard text input with optional validation.

**Example**:
```yaml
- id: custom-name
  action: interactive
  prompt: "Enter project name:"
  inputType: text
  validationPattern: "^[a-zA-Z0-9_-]+$"
  defaultValue: "my-project"
```

### Password (`password`)
Hidden text input for sensitive data.

**Example**:
```yaml
- id: api-key
  action: interactive
  prompt: "Enter your API key:"
  inputType: password
```

### Confirm (`confirm`)
Yes/No or True/False confirmation.

**Example**:
```yaml
- id: proceed
  action: interactive
  prompt: "Continue with deployment?"
  inputType: confirm
  defaultValue: "Yes"
```

### Choice (`choice`)
Select from predefined options.

**Example**:
```yaml
- id: environment
  action: interactive
  prompt: "Select environment:"
  inputType: choice
  choices: 
    - "development"
    - "staging" 
    - "production"
  defaultValue: "development"
```

### Multiline (`multiline`)
Multi-line text input for comments or descriptions.

**Example**:
```yaml
- id: description
  action: interactive
  prompt: "Enter project description:"
  inputType: multiline
  timeoutMs: 120000
```

## Validation

### Input Validation
Use `validationPattern` with regex to validate user input:

```yaml
- id: email
  action: interactive
  prompt: "Enter your email:"
  inputType: text
  validationPattern: "^[^@]+@[^@]+\.[^@]+$"
```

### Timeout Handling
Set timeouts to prevent indefinite waiting:

```yaml
- id: quick-response
  action: interactive
  prompt: "Quick decision needed:"
  inputType: confirm
  timeoutMs: 10000  # 10 seconds
```

## Context Integration

Interactive steps have access to workflow context:

- `{{variables}}` - Current workflow variables
- `{{stepCount}}` - Number of steps completed
- `{{iterationCount}}` - Current loop iteration (if applicable)
- `{{timestamp}}` - ISO timestamp of step execution

## Usage Examples

### Simple Confirmation
```yaml
steps:
  - id: deploy-confirm
    action: interactive
    prompt: "Deploy to production?"
    inputType: confirm
    defaultValue: "No"
```

### Complex Form Collection
```yaml
steps:
  - id: project-info
    action: interactive
    prompt: "Project name:"
    inputType: text
    validationPattern: "^[a-z][a-z0-9-]*$"
    defaultValue: "new-project"

  - id: environment-select
    action: interactive
    prompt: "Environment:"
    inputType: choice
    choices: ["dev", "staging", "prod"]
    defaultValue: "dev"

  - id: notes
    action: interactive
    prompt: "Additional notes:"
    inputType: multiline
    timeoutMs: 60000
```

## Integration Points

The interactive step returns structured data that can be used by:
- CLI interfaces (prompting user)
- Web UIs (displaying forms)
- APIs (returning input requirements)

### Return Data Structure
```json
{
  "stepId": "user-input",
  "prompt": "Enter your name:",
  "inputType": "text",
  "timeoutMs": 30000,
  "defaultValue": "",
  "validationPattern": "",
  "choices": [],
  "userInput": null,
  "requiresInteraction": true,
  "timestamp": "2026-01-15T10:30:00Z",
  "metadata": {
    "workflowName": "example-workflow",
    "totalSteps": 3,
    "currentIteration": 0
  }
}
```

## Best Practices

1. **Clear Prompts**: Write prompts that clearly explain what input is expected
2. **Appropriate Timeouts**: Set reasonable timeouts to prevent hanging workflows  
3. **Validation**: Use validation patterns to ensure data integrity
4. **Default Values**: Provide sensible defaults to streamline common cases
5. **Context Awareness**: Reference workflow variables in prompts when helpful

## Error Handling

Interactive steps validate all properties at parse time:
- Missing required fields throw descriptive errors
- Invalid regex patterns are caught during validation
- Timeout values must be non-negative numbers
- Choice input type requires non-empty choices array