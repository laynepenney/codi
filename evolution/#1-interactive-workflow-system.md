# Interactive Workflow System - Implementation Plan

**Date**: 2025-06-18  
**Status**: DRAFT  
**Purpose**: Create an interactive system for defining, developing, and executing model-aware multi-step workflows

---

## Feature Overview

### What is an Interactive Workflow?

An Interactive Workflow is a declarative system for automating complex, multi-step processes with:
- **Model-Specific Steps**: Switch between AI models during execution (e.g., use GLM for review, Sonnet for coding)
- **Conditional Branching**: Execute different paths based on conditions (e.g., PR approved? → merge vs. fix)
- **Loop Support**: Repeat steps until conditions are satisfied (e.g., review cycle until approved)
- **Manual Interaction**: Pause for human review/approval at key decision points
- **State Persistence**: Save and resume workflows later

### Example Use Case: PR Review Loop

A workflow that:
1. Creates a pull request
2. Switches to GLM model for initial review
3. Makes changes based on review comments
4. Commits and pushes changes
5. Switches back to original model for final review
6. If approved → merge and done
7. If not approved → repeat from step 2

### Example YAML Workflow

```yaml
name: pr-review-loop
description: Create PR, review with different models, iterate until approved
interactive: true
persistent: true

steps:
  - id: s1
    action: create-pr
    description: Create a pull request with gh
    
  - id: s2
    action: switch-model
    model: glm
    description: Switch to glm model for review
    
  - id: s3
    action: review-pr
    description: Review PR and make necessary comments
    
  - id: s4
    action: make-changes
    description: Make changes based on comments
    
  - id: s5
    action: commit-push
    description: Commit and push changes
    
  - id: s6
    action: switch-model
    model: original
    description: Switch back to original model
    
  - id: s7
    action: review-pr
    description: Review PR and make comments
    check: approved
    on-approved: s11
    on-rejected: s8
    
  - id: s8
    action: make-changes
    description: Make changes based on comments
    
  - id: s9
    action: commit-push
    description: Commit and push changes
    
  - id: s10
    action: loop
    to: s2
    condition: not-approved
    max-iterations: 5
    
  - id: s11
    action: self-review
    description: Post self-review comment
    
  - id: s12
    action: merge-pr
    description: Merge the PR
    
  - id: s13
    action: sync
    description: Sync with main branch
```

---

## Current State

### Existing Pipeline System (src/model-map/)
- **Linear execution**: Steps run sequentially from start to finish
- **Role-based models**: Use abstract roles (`fast`, `capable`, `reasoning`) rather than specific models
- **Variable substitution**: Basic `{variable_name}` replacement
- **Single-pass**: No loops or conditional branching
- **Non-interactive**: No human intervention points

### Limitations
- ❌ Cannot switch to specific models (only role-based)
- ❌ No conditional branching logic
- ❌ No loops or repetition
- ❌ No manual interaction/confirmation steps
- ❌ Cannot pause/resume workflows
- ❌ No state persistence

---

## Proposed Design

### Core Concepts

**Workflow**: A named, reusable set of steps that accomplish a goal  
**Step**: A single unit of work (model switch, action, conditional, loop, interactive)  
**Action**: Built-in operation (create-pr, review-pr, shell, ai-prompt, etc.)  
**Variable**: Data shared between steps (${pr_number}, ${approval_count})  
**State**: Current execution position, variables, history of completed steps

### New Step Types

1. **switch-model**: Change AI model for subsequent steps
2. **conditional**: Branch execution based on condition
3. **loop**: Repeat a sequence of steps
4. **interactive**: Pause for human interaction
5. **action**: Execute built-in or custom action

### New Commands

```bash
/workflow create <name>        # Interactive workflow builder
/workflow run <name> [step-id]  # Start or resume workflow execution
/workflow status               # Show current workflow state
/workflow pause                # Pause current workflow
/workflow resume <name>        # Resume paused workflow
/workflow list                 # List all available workflows
/workflow show <name>          # Display workflow definition
/workflow validate <name>      # Validate workflow syntax
```

---

## Technical Architecture

### File Structure

```
src/
├── workflow/
│   ├── manager.ts          # Workflow orchestration
│   ├── executor.ts         # Step execution engine
│   ├── state.ts            # State management & persistence
│   ├── parser.ts           # YAML parser & validator
│   ├── steps/
│   │   ├── index.ts        # Step registry
│   │   ├── switch-model.ts # Model switching
│   │   ├── conditional.ts  # Branching logic
│   │   ├── loop.ts         # Loop logic
│   │   └── interactive.ts  # Human interaction
│   ├── actions/
│   │   ├── index.ts        # Action registry
│   │   ├── pr.ts           # PR actions
│   │   ├── git.ts          # Git actions
│   │   ├── shell.ts        # Shell actions
│   │   └── ai.ts           # AI prompt actions
│   └── types.ts            # TypeScript interfaces
├── commands/
│   └── workflow-commands.ts # CLI commands
└── index.ts                # Integrate workflow system

tests/
└── workflow/
    ├── manager.test.ts
    ├── executor.test.ts
    ├── state.test.ts
    └── steps/
        └── (step tests)

~/.codi/workflows/
├── pr-review-loop.yaml    # User workflows
└── state/
    └── pr-review-loop.json # Workflow state
```

### Data Models

```typescript
interface Workflow {
  name: string;
  description: string;
  version?: string;
  interactive?: boolean;
  persistent?: boolean;
  variables?: Record<string, any>;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  action: string;
  description?: string;
  [key: string]: any; // Step-specific config
}

interface WorkflowState {
  name: string;
  currentStep: string;
  variables: Record<string, any>;
  history: StepExecution[];
  iterationCount: number;
  paused: boolean;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StepExecution {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  timestamp: string;
}
```

---

## Implementation Plan

### Phase 1: Core Workflow Engine (Weeks 1-2)
- [ ] Design workflow schema and TypeScript interfaces
- [ ] Implement YAML parser and validator
- [ ] Create WorkflowState class for state management
- [ ] Implement basic step executor
- [ ] Add workflow file loader (supports multiple locations)
- [ ] Create base workflow commands (list, show, validate)

### Phase 2: Model Switching (Week 2)
- [ ] Extend ModelRegistry for dynamic model switching
- [ ] Implement switch-model step processor
- [ ] Add context saving/restoration when switching models
- [ ] Update Agent to handle mid-workflow model changes
- [ ] Test model switching across providers (Anthropic, OpenAI, Ollama)

### Phase 3: Conditional Logic (Week 2-3)
- [ ] Implement condition evaluation system
- [ ] Create condition helpers (approved, file-exists, variable-equals)
- [ ] Add conditional step processor with branching
- [ ] Implement step jump/goto functionality
- [ ] Add on-success/on-error handlers

### Phase 4: Loop Support (Week 3)
- [ ] Implement loop step processor
- [ ] Add iteration counter and safety limits
- [ ] Create loop evaluation system
- [ ] Implement max-iterations enforcement
- [ ] Add loop history tracking

### Phase 5: Interactive Features (Week 3-4)
- [ ] Implement interactive step processor
- [ ] Create prompt system for human interaction
- [ ] Add pause/resume workflow functionality
- [ ] Implement workflow status tracking
- [ ] Add workflow history display

### Phase 6: Built-in Actions (Week 4)
- [ ] Implement action registry system
- [ ] Create PR actions (create-pr, review-pr, merge-pr)
- [ ] Implement Git actions (commit, push, sync)
- [ ] Add shell action for arbitrary commands
- [ ] Create AI prompt action
- [ ] Add custom action registration

### Phase 7: AI-Assisted Building (Week 5-6)
- [ ] Create interactive workflow builder command
- [ ] Implement step-by-step workflow creation with AI guidance
- [ ] Add workflow templates library
- [ ] Create natural language workflow import (describe workflow, AI generates YAML)
- [ ] Add workflow validation and suggestions
- [ ] Design AI prompt templates for common workflows

**Rationale**: Extended from 1 week to 2 weeks due to complexity of natural language understanding and AI prompt engineering required for this phase.

### Phase 8: Testing & Polish (Week 6)
- [ ] Write comprehensive unit tests
- [ ] Create integration tests
- [ ] Add example workflows
- [ ] Update documentation (CODI.md, README)
- [ ] Performance testing and optimization

**Timeline Update**: Extended from 5 weeks to 6 weeks total to accommodate AI-assisted building complexity.

---

## Testing Strategy

### Unit Tests
- [ ] Workflow schema validation
- [ ] Step execution logic for each step type
- [ ] Condition evaluation
- [ ] Loop handling (including safety limits)
- [ ] Variable substitution
- [ ] State persistence (save/load)
- [ ] Model switching
- [ ] Action registration and execution

### Integration Tests
- [ ] Complete workflow execution (all step types)
- [ ] Conditional branching paths
- [ ] Loop iterations with break conditions
- [ ] Interactive pauses and resumes
- [ ] Built-in action execution (PR, git, shell, AI)
- [ ] Multi-provider model switching
- [ ] State persistence across sessions

### Manual Testing
- [ ] Create workflows interactively with `/workflow create`
- [ ] Execute PR review workflow example
- [ ] Test pause/resume functionality
- [ ] Verify model switching with different providers
- [ ] Test workflow validation and error reporting
- [ ] Test workflow templates

### Test Workflows

```yaml
# Simple linear workflow
name: test-linear
steps:
  - id: s1
    action: shell
    command: "echo 'Step 1'"
  - id: s2
    action: shell
    command: "echo 'Step 2'"

# Conditional workflow
name: test-conditional
steps:
  - id: s1
    action: shell
    command: "test -f ${file} && echo 'exists' || echo 'not exists'"
    check: file-exists
    variable: file
    on-true: s3
  - id: s2
    action: shell
    command: "echo 'create file'"
    on-complete: s1
  - id: s3
    action: shell
    command: "echo 'done'"

# Loop workflow
name: test-loop
steps:
  - id: s1
    action: ai-prompt
    prompt: "Count current iteration: ${i}"
  - id: s2
    action: shell
    command: "echo $((i + 1)) > /tmp/counter.txt"
  - id: s3
    action: load-variable
    name: i
    from: counter.txt
  - id: s4
    action: loop
    to: s1
    condition: "i < 3"
    max-iterations: 5

# Model switching workflow
name: test-model-switch
steps:
  - id: s1
    action: switch-model
    model: glm
  - id: s2
    action: ai-prompt
    prompt: "You are GLM. Say hello."
  - id: s3
    action: switch-model
    model: original
  - id: s4
    action: ai-prompt
    prompt: "You are back to original model. Confirm."
```

---

## Migration from Existing Pipelines

The current pipeline system in `codi-models.yaml` will remain functional. Workflows are an enhancement, not a replacement.

### Migration Path

1. **Backward Compatibility**: Existing pipelines continue to work
2. **Hybrid Mode**: Pipelines can reference workflows and vice versa
3. **Migration Tool**: `/workflow migrate <pipeline-name>` to convert pipeline to workflow

### Key Differences

| Feature | Pipeline | Workflow |
|---------|----------|----------|
| Model selection | Role-based (fast/capable) | Specific models or roles |
| Flow control | Linear only | Conditional + loops |
| Human interaction | None | Interactive steps |
| State persistence | No | Yes |
| Model switching | No | Yes |
| File location | codi-models.yaml | Separate files or embedded |

---

## Rationale

### Why Build This?

**Problem**: Complex multi-step processes (like the PR review loop) are tedious and error-prone
- Manual switching between models for different perspectives
- Repetitive review cycles (review, fix, commit, push, repeat)
- Easy to forget steps or lose track of state
- No way to automate or save successful patterns

**Solution**: Declarative workflow system with AI assistance
- Define once, execute many times
- Model-specific steps leverage different AI strengths
- Conditional logic handles real-world branch points
- State persistence enables resumable workflows
- AI-assisted creation reduces learning curve

### Benefits

**Productivity**
- Automate repetitive multi-step processes
- Reduce manual intervention points
- Consistent execution of best practices
- Reusable workflows for common tasks

**Flexibility**
- Use the right model for each step (GLM for review, Sonnet for coding)
- Build once, customize per project
- Conditional logic for complex real-world flows
- Extensible action system

**Reliability**
- State persistence never loses progress
- Error handling with retry/skip logic
- Loop safety limits prevent infinite loops
- History tracking for debugging

**Developer Experience**
- AI-assisted workflow creation (describe what you want, let AI build it)
- Clear step-by-step progress indicators
- Easy to debug with workflow replay
- Shareable workflows across teams

### Risks & Mitigations

**Increased Token Usage**
- *Risk*: Multiple model switches and AI prompts increase costs
- *Mitigation*: Optimize prompts, cache model context, show cost estimates

**Complexity**
- *Risk*: Rich syntax might overwhelm users
- *Mitigation*: AI-assisted creation, templates, validation suggestions

**Backward Compatibility**
- *Risk*: Changes to pipeline system might break existing code
- *Mitigation*: Keep pipelines functional, gradual migration path

**Performance**
- *Risk*: Workflow system adds overhead
- *Mitigation*: Efficient state management, lazy model loading, background processing

---

## Success Criteria

### MVP (Must Have)
- [ ] Create and execute workflows with model switching
- [ ] Conditional step execution
- [ ] Loop support with safety limits
- [ ] State persistence (save/resume)
- [ ] Basic built-in actions (shell, ai-prompt)
- [ ] Workflow commands (run, status, pause, resume, list)

### Should Have
- [ ] Interactive workflow builder
- [ ] PR-related actions (create, review, merge)
- [ ] Git actions (commit, push, sync)
- [ ] Workflow templates
- [ ] Example workflows
- [ ] Comprehensive documentation

### Nice to Have
- [ ] Visual workflow editor
- [ ] Workflow debugging tools
- [ ] Workflow sharing/import-export
- [ ] Workflow marketplace
- [ ] Advanced condition expressions
- [ ] Parallel step execution

---

## Next Steps

1. **Review and Refine**: Get feedback on this plan
2. **Define MVP**: Agree on minimum viable feature set
3. **Create Technical Specs**: Detailed design for each component
4. **Set Timeline**: Schedule sprints and milestones
5. **Begin Implementation**: Start with Phase 1 - Core Workflow Engine

---

## Open Questions & Decisions

1. **Model Connection Pooling**: ✅ Decision: Option A (Disconnect/reconnect)
   - Simpler implementation (aligns with existing lazy loading patterns)
   - Uses fewer resources (important for CLI tool)
   - Connection overhead is acceptable for workflow scale

2. **Condition Expression Language**: ✅ Decision: Option A + JS Safety
   - Start with simple predefined conditions (approved, file-exists, variable-equals)
   - Add safe JavaScript eval for simple expressions (e.g., `${iteration} < 5`)
   - Defer complex DSL to phase 5+ if needed

3. **Workflow Permissions**: ✅ Decision: Option C (Prompt for sensitive)
   - Aligns with Codi's security model (explicit consent required)
   - Configurable auto-approve patterns for non-sensitive steps
   - Sensitive actions (write_file, bash) always prompt

4. **Integration with Existing Commands**: ✅ Decision: Option B (Workflows trigger commands)
   - Workflows can call existing `/` commands via special action
   - Wraps command results as step outputs
   - Cleaner architecture than duplication

---

## Cost Estimation

### Token Usage

| Workflow Type | Est. Tokens per Execution | Est. Cost (Claude) |
|---------------|---------------------------|-------------------|
| Simple (5 steps, no AI prompts) | ~1,000 | ~$0.001 |
| Medium (10 steps, 2 AI prompts) | ~10,000 | ~$0.01 |
| Complex (20 steps, 5 AI prompts) | ~50,000 | ~$0.05 |

### Model Switching Overhead

| Scenario | Latency Impact | Resource Impact |
|----------|---------------|-----------------|
| Model switch (same provider) | ~2-3 seconds | Low |
| Model switch (different provider) | ~5-10 seconds | Medium |

### Cost Mitigation Strategies

1. **Prompt Optimization**: Cache common prompts, reuse system context
2. **Model Selection**: Use cheaper models for routine steps (glm, haiku)
3. **Connection Caching**: Keep warm connections during workflow execution
4. **Cost Tracking**: Display estimated cost before workflow execution
5. **Budget Limits**: Optional budget cap per workflow execution

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Workflow Adoption | 50+ unique workflows created in 3 months | Analytics tracking |
| Workflow Completion Rate | 80% workflows complete successfully | State tracking |
| Token Cost Efficiency | Within 20% of estimated costs | Usage tracking |
| User Satisfaction | ≥4/5 rating for workflow feature | User surveys |

### Qualitative Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| User Understanding | Can create workflow without docs | User testing |
| Feature Discovery | Users find `/workflow` commands naturally | Usage patterns |
| Time Savings | Users report time reduction | Feedback surveys |
| Reliability | No data loss on pause/resume | Error tracking |

### Milestone-Based Goals

- **Month 1**: Core engine working, 5 example workflows
- **Month 2**: Model switching, conditional logic
- **Month 3**: Loop support, state persistence
- **Month 4**: Interactive builder, PR/git actions
- **Month 5**: AI-assisted creation, templates

---

## Approval Checklist

- [ ] Plan reviewed thoroughly
- [ ] Requirements clearly defined
- [ ] Technical feasibility confirmed
- [ ] Timeline agreed upon
- [ ] Resource allocation approved
- [ ] Ready to begin implementation

---

**Document Version**: 1.0  
**Last Updated**: 2025-06-18  
**Owner**: Layne Penney  
**Status**: Draft - Pending Review