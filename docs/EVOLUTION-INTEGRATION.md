# Evolution → GitHub Issues Integration

This document tracks the integration between the evolution proposal system and GitHub issues.

## Purpose
- Bridge thorough feature planning (evolution/) with actionable implementation tracking (GitHub Issues)
- Maintain evolution folder as the canonical design repository
- Use GitHub issues for prioritization, assignment, and implementation tracking

## Integration Status

| Evolution Proposal | GitHub Issue | Status | Priority | Planned Milestone |
|-------------------|--------------|--------|----------|------------------|
| #1 Interactive Workflow System | [#146](https://github.com/laynepenney/codi/issues/146) | DRAFT | HIGH | Future Release |

## Process Flow

### 1. Propose Feature
- Create evolution document in `evolution/#N-feature-name.md`
- Follow evolution template for comprehensive planning
- Submit as PR for community review

### 2. Create Tracking Issue
- Once evolution is approved, create GitHub issue
- Link to evolution document
- Assign priority, effort estimate
- Add to appropriate milestone

### 3. Track Implementation
- Reference evolution document in implementation PRs
- Use GitHub issue for discussion, assignment, milestones
- Update both evolution document and GitHub issue with progress

### 4. Completion
- When feature is fully implemented:
  - Update evolution status: IMPLEMENTED
  - Close GitHub issue
  - Move evolution to `completed/` subdirectory

## Benefits

**Evolution Documents**: Detailed design decisions, technical specs, alternatives considered
**GitHub Issues**: Actionable tracking, prioritization, assignment, milestone management

## Best Practices

- Always reference the evolution document "This implements evolution/#N-feature-name.md"
- Update both systems when design decisions change
- Use GitHub for time-sensitive decisions and scheduling
- Preserve evolution documentation as historical record

---

✅ **Status**: Integration system established
🎯 **Next**: Migrate existing proposals to GitHub issues