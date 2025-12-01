# TypeBox Patterns for OpenAPI Schema Generation

TypeBox schemas work seamlessly with `@fastify/swagger` to generate OpenAPI documentation. This reference covers patterns specific to OpenAPI generation.

## OpenAPI-Specific Annotations

TypeBox schemas support OpenAPI annotations through the schema options object.

### Description and Examples

```javascript
const { Type } = require('@sinclair/typebox');

const UserSchema = Type.Object({
  id: Type.String({
    format: 'uuid',
    description: 'Unique user identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  }),
  name: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'User full name',
    example: 'John Doe',
  }),
  email: Type.String({
    format: 'email',
    description: 'User email address',
    example: 'john@example.com',
  }),
  role: Type.Union([
    Type.Literal('user'),
    Type.Literal('admin'),
    Type.Literal('moderator'),
  ], {
    description: 'User role in the system',
    default: 'user',
  }),
  createdAt: Type.String({
    format: 'date-time',
    description: 'Timestamp when user was created',
    example: '2024-01-15T10:30:00Z',
  }),
}, {
  description: 'User account information',
  examples: [{
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'user',
    createdAt: '2024-01-15T10:30:00Z',
  }],
});
```

### Deprecated Fields

```javascript
const LegacyUserSchema = Type.Object({
  id: Type.String(),
  // Mark as deprecated in OpenAPI
  username: Type.String({
    deprecated: true,
    description: 'Use email instead',
  }),
  email: Type.String({ format: 'email' }),
});
```

### External Documentation

```javascript
const APIKeySchema = Type.Object({
  key: Type.String({
    description: 'API key for authentication',
    externalDocs: {
      description: 'Learn about API key authentication',
      url: 'https://docs.example.com/auth/api-keys',
    },
  }),
});
```

## Request Schemas

### Body Schema with Validation

```javascript
const CreateUserBody = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'User full name',
  }),
  email: Type.String({
    format: 'email',
    description: 'Valid email address',
  }),
  password: Type.String({
    minLength: 8,
    maxLength: 128,
    description: 'Password (min 8 characters)',
  }),
  role: Type.Optional(Type.Union([
    Type.Literal('user'),
    Type.Literal('admin'),
  ], {
    default: 'user',
    description: 'User role',
  })),
}, {
  description: 'Create user request body',
  additionalProperties: false,
});

// Use in route
fastify.post('/users', {
  schema: {
    description: 'Create a new user',
    tags: ['users'],
    body: CreateUserBody,
    response: {
      201: UserSchema,
    },
  },
}, handler);
```

### Query Parameters

```javascript
const ListUsersQuery = Type.Object({
  page: Type.Optional(Type.Integer({
    minimum: 1,
    default: 1,
    description: 'Page number',
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Items per page',
  })),
  sort: Type.Optional(Type.Union([
    Type.Literal('created_asc'),
    Type.Literal('created_desc'),
    Type.Literal('name_asc'),
    Type.Literal('name_desc'),
  ], {
    default: 'created_desc',
    description: 'Sort order',
  })),
  status: Type.Optional(Type.Union([
    Type.Literal('active'),
    Type.Literal('inactive'),
    Type.Literal('pending'),
  ], {
    description: 'Filter by status',
  })),
  search: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Search term for name or email',
  })),
});

fastify.get('/users', {
  schema: {
    description: 'List users with pagination and filtering',
    tags: ['users'],
    querystring: ListUsersQuery,
  },
}, handler);
```

### URL Parameters

```javascript
const UserIdParam = Type.Object({
  id: Type.String({
    format: 'uuid',
    description: 'User ID',
  }),
});

const UserPostParams = Type.Object({
  userId: Type.String({
    format: 'uuid',
    description: 'User ID',
  }),
  postId: Type.Integer({
    minimum: 1,
    description: 'Post ID',
  }),
});

fastify.get('/users/:id', {
  schema: {
    params: UserIdParam,
  },
}, handler);

fastify.get('/users/:userId/posts/:postId', {
  schema: {
    params: UserPostParams,
  },
}, handler);
```

### Headers

```javascript
const AuthHeaders = Type.Object({
  authorization: Type.String({
    pattern: '^Bearer .+$',
    description: 'JWT Bearer token',
    example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  }),
  'x-request-id': Type.Optional(Type.String({
    format: 'uuid',
    description: 'Request tracking ID',
  })),
  'x-api-version': Type.Optional(Type.String({
    pattern: '^\\d+\\.\\d+$',
    description: 'API version',
    example: '1.0',
  })),
});

fastify.get('/me', {
  schema: {
    headers: AuthHeaders,
  },
}, handler);
```

## Response Schemas

### Success Response

```javascript
const UserResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
  role: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
}, {
  description: 'User data',
});

const UsersListResponse = Type.Object({
  data: Type.Array(UserResponse, {
    description: 'List of users',
  }),
  pagination: Type.Object({
    page: Type.Integer(),
    limit: Type.Integer(),
    total: Type.Integer(),
    totalPages: Type.Integer(),
  }, {
    description: 'Pagination metadata',
  }),
}, {
  description: 'Paginated list of users',
});
```

### Error Response

```javascript
const ErrorResponse = Type.Object({
  error: Type.String({
    description: 'Error type',
    example: 'ValidationError',
  }),
  message: Type.String({
    description: 'Human-readable error message',
    example: 'Invalid email format',
  }),
  statusCode: Type.Integer({
    description: 'HTTP status code',
    example: 400,
  }),
  details: Type.Optional(Type.Array(Type.Object({
    field: Type.String({ description: 'Field with error' }),
    message: Type.String({ description: 'Field-specific error message' }),
  }), {
    description: 'Field-level validation errors',
  })),
}, {
  description: 'Error response',
});

const NotFoundResponse = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String({
    example: 'User not found',
  }),
  statusCode: Type.Literal(404),
});

const UnauthorizedResponse = Type.Object({
  error: Type.Literal('Unauthorized'),
  message: Type.String({
    example: 'Invalid or missing authentication token',
  }),
  statusCode: Type.Literal(401),
});
```

### Complete Route with Responses

```javascript
fastify.get('/users/:id', {
  schema: {
    description: 'Get user by ID',
    summary: 'Get user',
    tags: ['users'],
    operationId: 'getUserById',
    security: [{ bearerAuth: [] }],
    params: UserIdParam,
    response: {
      200: {
        description: 'User found',
        ...UserResponse,
      },
      401: {
        description: 'Authentication required',
        ...UnauthorizedResponse,
      },
      404: {
        description: 'User not found',
        ...NotFoundResponse,
      },
    },
  },
}, handler);
```

## Reusable Schemas with $id

### Registering Schemas

```javascript
// Define schemas with $id for referencing
const UserSchemaWithId = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
}, { $id: 'User' });

const AddressSchemaWithId = Type.Object({
  street: Type.String(),
  city: Type.String(),
  country: Type.String(),
  postalCode: Type.String(),
}, { $id: 'Address' });

const ErrorSchemaWithId = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Integer(),
}, { $id: 'Error' });

// Register with Fastify
fastify.addSchema(UserSchemaWithId);
fastify.addSchema(AddressSchemaWithId);
fastify.addSchema(ErrorSchemaWithId);

// Reference in routes
fastify.get('/users/:id', {
  schema: {
    response: {
      200: Type.Ref(UserSchemaWithId),
      404: Type.Ref(ErrorSchemaWithId),
    },
  },
}, handler);
```

### Composing Schemas

```javascript
// Schema with nested reference
const UserWithAddressSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
  address: Type.Ref(AddressSchemaWithId),
  billingAddress: Type.Optional(Type.Ref(AddressSchemaWithId)),
}, { $id: 'UserWithAddress' });

// Array of referenced schemas
const UsersArrayResponse = Type.Object({
  users: Type.Array(Type.Ref(UserSchemaWithId)),
  total: Type.Integer(),
});
```

## Discriminated Unions

For polymorphic types in OpenAPI.

```javascript
// Base event with discriminator
const BaseEvent = Type.Object({
  id: Type.String({ format: 'uuid' }),
  timestamp: Type.String({ format: 'date-time' }),
});

// Specific event types
const UserCreatedEvent = Type.Intersect([
  BaseEvent,
  Type.Object({
    type: Type.Literal('user.created'),
    data: Type.Object({
      userId: Type.String({ format: 'uuid' }),
      email: Type.String({ format: 'email' }),
    }),
  }),
]);

const UserDeletedEvent = Type.Intersect([
  BaseEvent,
  Type.Object({
    type: Type.Literal('user.deleted'),
    data: Type.Object({
      userId: Type.String({ format: 'uuid' }),
      reason: Type.Optional(Type.String()),
    }),
  }),
]);

const PaymentEvent = Type.Intersect([
  BaseEvent,
  Type.Object({
    type: Type.Literal('payment.completed'),
    data: Type.Object({
      amount: Type.Number(),
      currency: Type.String(),
      orderId: Type.String(),
    }),
  }),
]);

// Union of events
const WebhookEvent = Type.Union([
  UserCreatedEvent,
  UserDeletedEvent,
  PaymentEvent,
], {
  description: 'Webhook event payload',
});

// Use in webhook endpoint
fastify.post('/webhooks', {
  schema: {
    description: 'Receive webhook events',
    tags: ['webhooks'],
    body: WebhookEvent,
    response: {
      200: Type.Object({
        received: Type.Boolean(),
      }),
    },
  },
}, handler);
```

## File Upload Schemas

```javascript
// Multipart form data
const FileUploadBody = Type.Object({
  file: Type.Any({
    description: 'File to upload',
  }),
  description: Type.Optional(Type.String({
    maxLength: 500,
    description: 'File description',
  })),
});

// File response
const FileResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  filename: Type.String(),
  mimeType: Type.String(),
  size: Type.Integer({ description: 'File size in bytes' }),
  url: Type.String({ format: 'uri' }),
  createdAt: Type.String({ format: 'date-time' }),
});

fastify.post('/files', {
  schema: {
    description: 'Upload a file',
    tags: ['files'],
    consumes: ['multipart/form-data'],
    body: FileUploadBody,
    response: {
      201: FileResponse,
    },
  },
}, handler);
```

## Nullable vs Optional

```javascript
// Optional: Field may be omitted
const WithOptional = Type.Object({
  name: Type.String(),
  nickname: Type.Optional(Type.String()),  // Can be missing
});
// Valid: { name: "John" }
// Valid: { name: "John", nickname: "Johnny" }

// Nullable: Field must be present but can be null
const WithNullable = Type.Object({
  name: Type.String(),
  deletedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
// Valid: { name: "John", deletedAt: null }
// Valid: { name: "John", deletedAt: "2024-01-15T10:00:00Z" }
// Invalid: { name: "John" }  // deletedAt is required

// Optional AND Nullable
const WithBoth = Type.Object({
  name: Type.String(),
  bio: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
// Valid: { name: "John" }
// Valid: { name: "John", bio: null }
// Valid: { name: "John", bio: "Hello" }
```

## OpenAPI Schema Modifiers

### ReadOnly and WriteOnly

```javascript
const UserSchema = Type.Object({
  id: Type.String({
    format: 'uuid',
    readOnly: true,  // Only in responses, not requests
    description: 'Auto-generated ID',
  }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
  password: Type.String({
    writeOnly: true,  // Only in requests, not responses
    minLength: 8,
    description: 'User password (never returned)',
  }),
  createdAt: Type.String({
    format: 'date-time',
    readOnly: true,
  }),
});
```

### Min/Max Items for Arrays

```javascript
const TagsSchema = Type.Array(Type.String(), {
  minItems: 1,
  maxItems: 10,
  uniqueItems: true,
  description: 'List of tags (1-10 unique values)',
});

const BatchRequestSchema = Type.Object({
  operations: Type.Array(Type.Object({
    method: Type.Union([
      Type.Literal('GET'),
      Type.Literal('POST'),
      Type.Literal('PUT'),
      Type.Literal('DELETE'),
    ]),
    path: Type.String(),
    body: Type.Optional(Type.Any()),
  }), {
    minItems: 1,
    maxItems: 100,
    description: 'Batch operations (max 100)',
  }),
});
```

## Complete CRUD Example

```javascript
const { Type } = require('@sinclair/typebox');

// Schemas
const ProductId = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const Product = Type.Object({
  id: Type.String({ format: 'uuid', readOnly: true }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  price: Type.Number({ minimum: 0 }),
  currency: Type.String({ pattern: '^[A-Z]{3}$', example: 'USD' }),
  category: Type.String(),
  inStock: Type.Boolean({ default: true }),
  createdAt: Type.String({ format: 'date-time', readOnly: true }),
  updatedAt: Type.String({ format: 'date-time', readOnly: true }),
}, { $id: 'Product' });

const CreateProduct = Type.Omit(Product, ['id', 'createdAt', 'updatedAt']);
const UpdateProduct = Type.Partial(CreateProduct);

const ProductList = Type.Object({
  data: Type.Array(Type.Ref(Product)),
  pagination: Type.Object({
    page: Type.Integer(),
    limit: Type.Integer(),
    total: Type.Integer(),
  }),
});

const ProductQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
  category: Type.Optional(Type.String()),
  minPrice: Type.Optional(Type.Number({ minimum: 0 })),
  maxPrice: Type.Optional(Type.Number({ minimum: 0 })),
  inStock: Type.Optional(Type.Boolean()),
});

const Error = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Integer(),
}, { $id: 'Error' });

// Register schemas
fastify.addSchema(Product);
fastify.addSchema(Error);

// Routes
fastify.get('/products', {
  schema: {
    description: 'List products with filtering',
    summary: 'List products',
    tags: ['products'],
    operationId: 'listProducts',
    querystring: ProductQuery,
    response: {
      200: ProductList,
    },
  },
}, listProducts);

fastify.post('/products', {
  schema: {
    description: 'Create a new product',
    summary: 'Create product',
    tags: ['products'],
    operationId: 'createProduct',
    security: [{ bearerAuth: [] }],
    body: CreateProduct,
    response: {
      201: { description: 'Product created', ...Product },
      400: { description: 'Validation error', $ref: 'Error#' },
      401: { description: 'Unauthorized', $ref: 'Error#' },
    },
  },
}, createProduct);

fastify.get('/products/:id', {
  schema: {
    description: 'Get product by ID',
    summary: 'Get product',
    tags: ['products'],
    operationId: 'getProduct',
    params: ProductId,
    response: {
      200: { description: 'Product found', $ref: 'Product#' },
      404: { description: 'Product not found', $ref: 'Error#' },
    },
  },
}, getProduct);

fastify.patch('/products/:id', {
  schema: {
    description: 'Update product',
    summary: 'Update product',
    tags: ['products'],
    operationId: 'updateProduct',
    security: [{ bearerAuth: [] }],
    params: ProductId,
    body: UpdateProduct,
    response: {
      200: { description: 'Product updated', $ref: 'Product#' },
      400: { description: 'Validation error', $ref: 'Error#' },
      401: { description: 'Unauthorized', $ref: 'Error#' },
      404: { description: 'Product not found', $ref: 'Error#' },
    },
  },
}, updateProduct);

fastify.delete('/products/:id', {
  schema: {
    description: 'Delete product',
    summary: 'Delete product',
    tags: ['products'],
    operationId: 'deleteProduct',
    security: [{ bearerAuth: [] }],
    params: ProductId,
    response: {
      204: { description: 'Product deleted', type: 'null' },
      401: { description: 'Unauthorized', $ref: 'Error#' },
      404: { description: 'Product not found', $ref: 'Error#' },
    },
  },
}, deleteProduct);
```

## TypeScript Type Inference

```typescript
import { Type, Static } from '@sinclair/typebox';

const UserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
});

// Infer TypeScript type from schema
type User = Static<typeof UserSchema>;
// Equivalent to:
// type User = {
//   id: string;
//   name: string;
//   email: string;
// }

// Use in handler
fastify.get<{ Reply: User }>('/users/:id', {
  schema: {
    response: { 200: UserSchema },
  },
}, async (request, reply): Promise<User> => {
  const user: User = await findUser(request.params.id);
  return user;
});
```
