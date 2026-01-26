# Evolution - Feature Proposals

This directory contains proposals for new features and enhancements to Codi.

## Purpose

The `evolution/` directory provides a structured way to plan, discuss, and track feature development before implementation. This ensures:

- **Thorough planning** before writing code
- **Community feedback** and stakeholder input
- **Clear documentation** of design decisions
- **Traceability** from idea to implementation
- **Prioritization** and scheduling transparency

## Process Flow

```
1. Create Proposal → 2. Community Review → 3. Refine & Approve → 4. Schedule → 5. Implement → 6. Track & Archive
   (#N-*.md)            (PR Discussion)            (Labels)        (Milestone)      (Implementation)   (Completed/)
```

## Creating a Feature Proposal

### 1. Name Your Proposal

Use the format: `#N-feature-name.md`

- `#N` = Sequential number (01, 02, 03, etc.)
- `feature-name` = Short, descriptive kebab-case name

**Examples:**
- `#01-interactive-workflow-system.md`
- `#02-vim-mode-support.md`
- `#03-multi-file-search-ui.md`
- `#04-plugin-marketplace.md`

### 2. Use the Proposal Template

Copy and use the template below as a starting point:

```markdown
# Feature Name

**Status**: 📋 DRAFT | 🔄 UNDER REVIEW | ✅ APPROVED | 🔨 IN PROGRESS | ✅ IMPLEMENTED  
**Proposal Date**: YYYY-MM-DD  
**Assigned To**: @username (optional)  
**Estimated Effort**: X weeks/months  
**Priority**: TODO | HIGH | MEDIUM | LOW | BACKLOG

---

## Overview

### What is this feature?

Brief description of the feature being proposed.

### Problem Statement

What problem does this solve? Why do we need this?

### Solution

High-level description of the proposed solution.

---

## Goals

- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## Non-Goals

What is explicitly out of scope for this feature?

---

## Background & Context

### Current State

How does the system currently work? What are the limitations?

### Prior Art

Are there existing solutions? What can we learn from them?

### User Stories

As a [type of user], I want [goal] so that [benefit].

---

## Proposed Design

### Technical Approach

How will this work technically?

### Architecture

Any new components or changes to existing architecture?

### API/UI Changes

Will this add new commands, UI elements, or APIs?

---

## Implementation Plan

### Phase 1: Foundation
- [ ] Task 1
- [ ] Task 2

### Phase 2: Core Features
- [ ] Task 3
- [ ] Task 4

### Phase 3: Polish & Documentation
- [ ] Task 5
- [ ] Task 6

**Timeline**: X weeks/months

---

## Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Option A | ... | ... | ✅ Selected |
| Option B | ... | ... | ❌ Rejected |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Risk 1 | High/Emed/Low | How to mitigate |
| Risk 2 | High/Emed/Low | How to mitigate |

---

## Success Criteria

### Must Have (MVP)
- [ ] Criterion 1
- [ ] Criterion 2

### Should Have
- [ ] Criterion 3
- [ ] Criterion 4

### Nice to Have
- [ ] Criterion 5

---

## Testing Strategy

- Unit tests for [components]
- Integration tests for [flows]
- Manual testing for [scenarios]
- Performance testing for [metrics]

---

## Open Questions

1. Question 1?
2. Question 2?

---

## References

- Related issue: #123
- Discussion: https://github.com/.../discussions/123
- External resources: [links]

---

**Document Version**: 1.0  
**Last Updated**: YYYY-MM-DD  
**Owner**: @username
```

### 3. Create a Pull Request

```bash
# Create feature branch
git checkout -b feat/proposal-#N main

# Add your proposal
vim evolution/#N-your-feature.md
git add evolution/#N-your-feature.md
git commit -m "docs: add feature proposal for #N <feature-name>"

# Push and create PR
git push -u origin feat/proposal-#N
gh pr create --title "Feature Proposal: <Feature Name> (#N)" \
  --body "See evolution/#N-your-feature.md for details"
```

## Review Process

### 1. Community Feedback

- Open for discussion in the PR
- Gather feedback from stakeholders
- Address concerns and refine the proposal

### 2. Approval Process

#### Labels Used

- `proposal` - Initial proposal state
- `under-review` - Actively being discussed
- `approved` - Approved for implementation
- `on-hold` - Deferred or waiting for resources
- `rejected` - Not pursued (document rationale)

#### Review Criteria

- ✅ Clear problem statement
- ✅ Well-defined goals and scope
- ✅ Thoughtful design
- ✅ Feasible implementation plan
- ✅ Reasonable timeline
- ✅ Testing strategy
- ✅ Community support

### 3. Scheduling

Once approved:
- Add to project roadmap
- Assign to a milestone
- Estimate effort and resources
- Schedule implementation sprint

## Implementation Tracking

### Active Implementation

When implementation begins:
1. Create implementation branch: `feat/feature-name`
2. Reference proposal in PR description: "Implements evolution/#N-feature-name.md"
3. Update proposal status to "IN PROGRESS"
4. Track progress with checkboxes

### Completion

When feature is complete:
1. Update proposal status to "IMPLEMENTED"
2. Move proposal to `completed/` subdirectory
3. Add implementation PR link to proposal
4. Celebrate the release! 🎉

## Directory Structure

```
evolution/
├── README.md                     # This file
├── #01-interactive-workflow-system.md
├── #02-vim-mode-support.md
├── #03-multi-file-search-ui.md
├── completed/                    # Implemented features
│   ├── #01-interactive-workflow-system.md
│   └── #04-plugin-marketplace.md
└── rejected/                     # Rejected proposals (with rationale)
    └── #05-deprecated-feature.md
```

## Best Practices

### Before Creating a Proposal

1. **Search existing proposals** - Don't duplicate work
2. **Discuss informally first** - Get early feedback in Discord/discussions
3. **Do research** - Look at prior art and existing solutions
4. **Start small** - Focus on core value, avoid scope creep

### Writing Good Proposals

- **Be specific** - Vague proposals are hard to evaluate
- **Use examples** - Show, don't just tell
- **Consider alternatives** - Explain why your approach is best
- **Think about edge cases** - Anticipate problems
- **Focus on user value** - Why should users care?

### During Review

- **Be open to feedback** - Collaborate and iterate
- **Defend your design** - Explain reasoning clearly
- **Compromise when appropriate** - Perfect is the enemy of good
- **Reference similar ideas** - Learn from past discussions

## Proposal Status

| # | Feature | Status | Priority | Est. Effort | Assigned To |
|---|---------|--------|----------|-------------|-------------|
| 01 | Interactive Workflow System | ✅ IMPLEMENTED | HIGH | 5 weeks | - |
| 02 | Enhanced Web Search | ✅ IMPLEMENTED | HIGH | 3 weeks | - |
| 03 | LSP Integration | 🚀 PROPOSED | HIGH | 4 weeks | @laynepenney |

## Questions?

For questions about the evolution process:
- **GitHub Discussions**: Use #evolution tag
- **Discord**: Ask in #features channel
- **Issues**: Tag with `evolution` label

---

**Process Version**: 1.0  
**Last Updated**: 2025-06-18  
**Maintainer**: Codi Team