# Development Commands

## Environment Configuration

The application uses environment variables to control network configuration:

```
# Set to 'development' to use Sepolia as default, or 'production' to use Mainnet as default
NEXT_PUBLIC_ENVIRONMENT=development
```

When changing to production, you must:
1. Update the .env.local file with `NEXT_PUBLIC_ENVIRONMENT=production`
2. Rebuild and restart the application

## NextJS App
```bash
# Start the development server
yarn start

# Build the application
yarn next:build

# Run TypeScript type checking
yarn next:check-types

# Run linting
yarn next:lint

# Format code
yarn next:format
```

## Foundry Smart Contracts
```bash
# Build the smart contracts
yarn foundry:build

# Run tests
yarn foundry:test

# Deploy to Sepolia testnet
yarn foundry:deploy:sepolia

# Deploy to Ethereum mainnet
yarn foundry:deploy:mainnet

# Verify all deployed contracts
yarn foundry:verify
```

## Code Style Preferences
- Use TypeScript types for all variables
- Use React functional components with hooks
- Use `const` over `let` when possible
- Use async/await for asynchronous code
- Prefer named exports over default exports
- Use camelCase for variables and functions, PascalCase for components and types

## Project Structure
- `/packages/nextjs/` - Frontend application
- `/packages/foundry/` - Smart contracts
  - `/src/` - Contract source files
  - `/script/` - Deployment scripts
  - `/test/` - Contract tests