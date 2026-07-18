```markdown
# self_print Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill covers the development patterns and best practices for the `self_print` repository, a TypeScript project using the Next.js framework. The codebase features a modular structure for UI components, API endpoints, and backend logic, with a focus on clear commit conventions and maintainable code organization. It also includes an agent component (with TypeScript and PowerShell) for handling print jobs.

## Coding Conventions

- **File Naming:**  
  Use camelCase for files, e.g.:
  ```
  src/components/uploadForm.tsx
  src/lib/dbSupabase.ts
  ```

- **Import Style:**  
  Use path aliases for imports. Example:
  ```typescript
  import { fetchJobs } from '@/lib/db';
  import UploadForm from '@/components/UploadForm';
  ```

- **Export Style:**  
  Prefer named exports:
  ```typescript
  // src/lib/db.ts
  export function fetchJobs() { /* ... */ }
  export function saveJob() { /* ... */ }
  ```

- **Commit Messages:**  
  Follow the [Conventional Commits](https://www.conventionalcommits.org/) standard.  
  Prefixes: `feat`, `fix`, `chore`  
  Example:
  ```
  feat: add file upload progress indicator
  fix: correct job status update logic
  chore: update dependencies
  ```

## Workflows

### Feature Development with Component and Style Update
**Trigger:** When adding or enhancing a UI feature that involves both logic and appearance.  
**Command:** `/new-ui-feature`

1. Implement or update the React component in `src/components/*.tsx`.
   ```tsx
   // src/components/UploadForm.tsx
   export function UploadForm() {
     // component logic
   }
   ```
2. Update or add corresponding styles in `src/app/globals.css`.
   ```css
   /* src/app/globals.css */
   .upload-form {
     margin: 1rem 0;
   }
   ```

### API or DB Feature Extension
**Trigger:** When adding or extending backend functionality (e.g., new job/file operations).  
**Command:** `/extend-backend`

1. Update or add logic in `src/lib/db*.ts` (database logic).
   ```typescript
   // src/lib/db.ts
   export function addPrintJob(job) { /* ... */ }
   ```
2. Update or add API endpoint in `src/app/api/**/*.ts`.
   ```typescript
   // src/app/api/jobs/route.ts
   export async function POST(req: Request) { /* ... */ }
   ```
3. Update or add tests in `src/lib/*.test.ts`.
   ```typescript
   // src/lib/db.bulk.test.ts
   import { addPrintJob } from './db';
   test('adds a print job', () => { /* ... */ });
   ```

### Agent Feature or Bugfix
**Trigger:** When changing how the agent processes or prints files.  
**Command:** `/update-agent`

1. Update logic in `agent/src/index.ts`.
   ```typescript
   // agent/src/index.ts
   function processPrintJob(job) { /* ... */ }
   ```
2. If needed, update PowerShell script in `agent/print-image.ps1`.
   ```powershell
   # agent/print-image.ps1
   Start-Process -FilePath $printerApp -ArgumentList $filePath
   ```

## Testing Patterns

- **Test File Pattern:**  
  Test files are named with `.test.` in the filename, e.g., `db.bulk.test.ts`.
- **Framework:**  
  The specific test framework is not detected, but tests are colocated with the code in `src/lib/`.
- **Example Test:**
  ```typescript
  // src/lib/db.bulk.test.ts
  import { addPrintJob } from './db';
  test('adds a print job', () => {
    // test implementation
  });
  ```

## Commands

| Command           | Purpose                                              |
|-------------------|------------------------------------------------------|
| /new-ui-feature   | Start a new UI feature or update with style changes  |
| /extend-backend   | Add or extend backend/API/database functionality     |
| /update-agent     | Update agent logic or scripts for print job handling |
```
