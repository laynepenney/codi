## PTY harness
For interactive CLI integration tests (running the CLI in a *real TTY* and asserting on interactive output), use:
- `tests/helpers/pty.ts` (`PtyHarness`)

### Enabling PTY tests
PTY tests are **skipped by default** because `node-pty` can be flaky/unavailable in some CI/sandbox environments.

Enable them locally with:

```bash
CODI_RUN_PTY_TESTS=1 pnpm test
```

---

Adding a New Tool
==================

To add a new tool to the AI Assistant project, follow these steps:

1.  **Create a New File**: Create a new JavaScript file in the `src/tools/` folder using your preferred IDE.

    ```bash
mkdir src/tools/
```
2.  **Import `BaseTool`**: Import the `BaseTool` class from `base.ts`

        ```javascript
        import { BaseTool } from './tools/base';
        ```

3.  **Extend `BaseTool`**: Create a new JavaScript file in the `src/tools/` folder, e.g., add_tool.js.

    ```javascript
import { BaseTool } from './tools/base';

// Extending base tool, override properties as needed
class MyTool extends BaseTool {
    getDefinition(): { [key: string]: any } {
        return {
            name: 'my-tool', // Unique identifier for your tool
            description: 'Description for the AI model',
            input_schema: { /* Your schema here */ },
            required_fields: ['field1'], // Field names (as keys) that are used as inputs.
            output_schema: { /* Format of response from this field */ },
        };
    }

    async execute(inputs): Promise<string> {
        const output = 'The result is...' + inputs.field1;
        return(output);
    }
}
```

4.  **Register the Tool**: Update `tools/index.ts` with a new entry for your tool:

    ```typescript
// Registering tools here
export declare class MyTool implements BaseTool;

```
5.  **Test Your Tool**: Run tests to ensure your tool works correctly:

    ```bash
pnpm test -- tests/my-tool.test.ts
```