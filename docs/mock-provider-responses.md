# Mock Provider Examples for Workflow E2E Tests

This document demonstrates realistic mock responses for different provider/model combinations used in workflow testing.

## Example Mock Responses

### Anthropic Claude Responses

**Claude-3-5-Haiku-Latest** (Fast, efficient reviews):
```
"I've completed a quick review of the code. The syntax looks correct and the structure is clean. I spotted a few minor style issues but nothing critical. Overall, this code appears ready for deeper analysis."
```

**Claude-Sonnet-4-20250514** (Detailed analysis):
```
"## Detailed Analysis

After thorough examination, I've identified several key areas:

### Architecture
- The design follows good patterns but lacks proper dependency injection
- Error handling could be more comprehensive

### Security
- Input validation appears adequate
- Authentication flow needs stronger token validation

### Performance
- Database queries could be optimized with indexes
- Consider caching for frequently accessed data

### Recommendations
- Add more test coverage for edge cases
- Implement proper logging throughout"
```

### OpenAI GPT-4O Responses

**GPT-4O** (Alternative perspective):
```
"## Alternative Perspective Review

Looking at this from a different angle:

### Unique Findings
- The authentication flow uses outdated session management
- Consider implementing refresh tokens for better security
- The UI state management could use Redux toolkit for scalability

### Edge Cases
- Need to handle network timeout scenarios
- Race conditions possible in concurrent user scenarios

### Modern Practices
- Suggest adopting GraphQL for better type safety
- Consider micro-frontend architecture for larger applications"
```

### Ollama Llama Responses

**Llama3.2** (Synthesis and recommendations):
```
"## Synthesis of All Reviews

### Critical Issues (Must Fix)
1. Security: Implement proper token validation
2. Performance: Add database indexes on frequently queried fields

### Important Improvements (Should Fix Soon)
1. Architecture: Add dependency injection for testability
2. Error Handling: Comprehensive error boundaries

### Nice-to-Have Enhancements
1. Modernization: Consider GraphQL adoption
2. Testing: Increase edge case coverage

### Estimated Effort
- Critical: 2-3 days
- Important: 1 week
- Nice-to-Have: 2-3 weeks"
```

## Usage in Tests

These mock responses are used in the `tests/workflow-multi-model-e2e.test.ts` file to simulate real provider behavior:

```typescript
// Example usage in test setup
const mockProviders = [
  new MockProvider('anthropic', 'claude-sonnet-4-20250514'),
  new MockProvider('openai', 'gpt-4o'),
  new MockProvider('ollama', 'llama3.2')
];

// Each provider generates appropriate responses based on model
const response = await mockProviders[0].generateResponse('review prompt');
```

## Response Characteristics

- **Claude Haiku**: Concise, quick assessments
- **Claude Sonnet**: Detailed, structured analysis
- **GPT-4O**: Different perspective, modern practices
- **Llama3.2**: Practical recommendations with effort estimates

These responses ensure that multi-model workflows receive varied, realistic feedback that exercises the workflow engine effectively.