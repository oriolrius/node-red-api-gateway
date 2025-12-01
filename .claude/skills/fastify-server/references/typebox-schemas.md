# TypeBox Schema Validation Reference

TypeBox is a JSON Schema type builder that provides static type inference for TypeScript while generating standard JSON Schema at runtime. Fastify natively supports TypeBox schemas for request and response validation.

## Installation

```bash
npm install @sinclair/typebox
```

## Basic Types

```javascript
const { Type, Static } = require('@sinclair/typebox');

// Primitive types
const StringSchema = Type.String();                    // { type: 'string' }
const NumberSchema = Type.Number();                    // { type: 'number' }
const IntegerSchema = Type.Integer();                  // { type: 'integer' }
const BooleanSchema = Type.Boolean();                  // { type: 'boolean' }
const NullSchema = Type.Null();                        // { type: 'null' }

// With constraints
const ConstrainedString = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[a-zA-Z]+$',
});

const ConstrainedNumber = Type.Number({
  minimum: 0,
  maximum: 100,
  exclusiveMinimum: 0,
  multipleOf: 0.1,
});

const ConstrainedInteger = Type.Integer({
  minimum: 1,
  maximum: 1000,
});
```

## String Formats

```javascript
// Built-in formats
const EmailSchema = Type.String({ format: 'email' });
const UriSchema = Type.String({ format: 'uri' });
const UuidSchema = Type.String({ format: 'uuid' });
const DateTimeSchema = Type.String({ format: 'date-time' });
const DateSchema = Type.String({ format: 'date' });
const TimeSchema = Type.String({ format: 'time' });
const Ipv4Schema = Type.String({ format: 'ipv4' });
const Ipv6Schema = Type.String({ format: 'ipv6' });

// Custom patterns
const PhoneSchema = Type.String({ pattern: '^\\+?[1-9]\\d{1,14}$' });
const SlugSchema = Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' });
```

## Objects

```javascript
// Basic object
const UserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String({ minLength: 1 }),
  email: Type.String({ format: 'email' }),
  age: Type.Integer({ minimum: 0 }),
  active: Type.Boolean(),
});

// Optional properties
const UserWithOptionals = Type.Object({
  id: Type.String(),
  name: Type.String(),
  nickname: Type.Optional(Type.String()),        // Optional field
  bio: Type.Optional(Type.String({ maxLength: 500 })),
});

// Additional properties
const FlexibleObject = Type.Object({
  required: Type.String(),
}, { additionalProperties: true });              // Allow extra properties

const StrictObject = Type.Object({
  required: Type.String(),
}, { additionalProperties: false });             // Reject extra properties

// Nested objects
const AddressSchema = Type.Object({
  street: Type.String(),
  city: Type.String(),
  country: Type.String(),
  postal: Type.String(),
});

const PersonSchema = Type.Object({
  name: Type.String(),
  address: AddressSchema,
  billingAddress: Type.Optional(AddressSchema),
});
```

## Arrays

```javascript
// Array of primitives
const StringArraySchema = Type.Array(Type.String());
const NumberArraySchema = Type.Array(Type.Number());

// Array with constraints
const TagsSchema = Type.Array(Type.String({ minLength: 1 }), {
  minItems: 1,
  maxItems: 10,
  uniqueItems: true,
});

// Array of objects
const UsersArraySchema = Type.Array(UserSchema);

// Tuple (fixed-length array with specific types)
const CoordinatesSchema = Type.Tuple([
  Type.Number(),  // latitude
  Type.Number(),  // longitude
]);

const VersionSchema = Type.Tuple([
  Type.Integer(), // major
  Type.Integer(), // minor
  Type.Integer(), // patch
]);
```

## Unions and Intersections

```javascript
// Union (oneOf)
const StatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('active'),
  Type.Literal('completed'),
]);

// Can also use enum-like approach
const RoleSchema = Type.Union([
  Type.Literal('user'),
  Type.Literal('admin'),
  Type.Literal('moderator'),
]);

// Mixed type union
const IdSchema = Type.Union([
  Type.String({ format: 'uuid' }),
  Type.Integer({ minimum: 1 }),
]);

// Intersection (allOf)
const TimestampedSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const TimestampedUserSchema = Type.Intersect([
  UserSchema,
  TimestampedSchema,
]);
```

## Enums and Literals

```javascript
// Literal values
const TrueSchema = Type.Literal(true);
const FooSchema = Type.Literal('foo');
const FortyTwoSchema = Type.Literal(42);

// Enum-like union of literals
const DirectionSchema = Type.Union([
  Type.Literal('north'),
  Type.Literal('south'),
  Type.Literal('east'),
  Type.Literal('west'),
]);

// Native enum support (TypeScript)
enum Status {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
}

const StatusEnumSchema = Type.Enum(Status);

// Numeric enum
enum Priority {
  Low = 0,
  Medium = 1,
  High = 2,
}

const PrioritySchema = Type.Enum(Priority);
```

## Records and Maps

```javascript
// Record (object with dynamic keys)
const ScoresSchema = Type.Record(Type.String(), Type.Number());
// Validates: { "player1": 100, "player2": 85 }

// Record with constrained keys
const ConfigSchema = Type.Record(
  Type.String({ pattern: '^[a-z_]+$' }),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()])
);

// Map alternative
const MetadataSchema = Type.Object({}, { additionalProperties: Type.String() });
```

## Nullable and Optional

```javascript
// Nullable (value or null)
const NullableString = Type.Union([Type.String(), Type.Null()]);

// Optional (may be omitted)
const OptionalString = Type.Optional(Type.String());

// Optional AND nullable
const OptionalNullableString = Type.Optional(
  Type.Union([Type.String(), Type.Null()])
);

// In object context
const FormDataSchema = Type.Object({
  name: Type.String(),                                    // Required
  email: Type.Optional(Type.String()),                    // Can be omitted
  phone: Type.Union([Type.String(), Type.Null()]),        // Required but can be null
  fax: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Can be omitted or null
});
```

## Complex Validation Patterns

```javascript
// Conditional schema (if/then/else not directly supported, use Union)
const PaymentSchema = Type.Union([
  Type.Object({
    type: Type.Literal('credit_card'),
    cardNumber: Type.String({ pattern: '^[0-9]{16}$' }),
    cvv: Type.String({ pattern: '^[0-9]{3,4}$' }),
    expiry: Type.String({ pattern: '^(0[1-9]|1[0-2])/[0-9]{2}$' }),
  }),
  Type.Object({
    type: Type.Literal('bank_transfer'),
    accountNumber: Type.String(),
    routingNumber: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('paypal'),
    email: Type.String({ format: 'email' }),
  }),
]);

// Self-referencing schemas (recursive)
const CategorySchema = Type.Recursive(Self =>
  Type.Object({
    name: Type.String(),
    children: Type.Optional(Type.Array(Self)),
  })
);

// Validates nested categories:
// { name: "Electronics", children: [{ name: "Phones", children: [...] }] }
```

## Fastify Integration Examples

### Request Body Validation

```javascript
const { Type, Static } = require('@sinclair/typebox');

const CreateUserBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 8 }),
  role: Type.Optional(Type.Union([
    Type.Literal('user'),
    Type.Literal('admin'),
  ])),
});

// TypeScript type inference
// type CreateUserBodyType = Static<typeof CreateUserBody>;

fastify.post('/users', {
  schema: {
    body: CreateUserBody,
  },
}, async (request, reply) => {
  const { name, email, password, role } = request.body;
  // All fields are validated
  return createUser({ name, email, password, role });
});
```

### URL Parameters Validation

```javascript
const GetUserParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const GetPostParams = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  postId: Type.Integer({ minimum: 1 }),
});

fastify.get('/users/:id', {
  schema: {
    params: GetUserParams,
  },
}, async (request) => {
  const { id } = request.params;
  return findUser(id);
});

fastify.get('/users/:userId/posts/:postId', {
  schema: {
    params: GetPostParams,
  },
}, async (request) => {
  const { userId, postId } = request.params;
  return findPost(userId, postId);
});
```

### Query String Validation

```javascript
const SearchQuery = Type.Object({
  q: Type.String({ minLength: 1 }),
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  sort: Type.Optional(Type.Union([
    Type.Literal('asc'),
    Type.Literal('desc'),
  ])),
  filters: Type.Optional(Type.Array(Type.String())),
});

fastify.get('/search', {
  schema: {
    querystring: SearchQuery,
  },
}, async (request) => {
  const { q, page, limit, sort, filters } = request.query;
  return search({ q, page, limit, sort, filters });
});
```

### Response Schema

```javascript
const UserResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorResponse = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Integer(),
});

const PaginatedUsersResponse = Type.Object({
  data: Type.Array(UserResponse),
  pagination: Type.Object({
    page: Type.Integer(),
    limit: Type.Integer(),
    total: Type.Integer(),
    totalPages: Type.Integer(),
  }),
});

fastify.get('/users', {
  schema: {
    response: {
      200: PaginatedUsersResponse,
      400: ErrorResponse,
      500: ErrorResponse,
    },
  },
}, async (request) => {
  // Response is serialized according to schema
  // Extra fields are removed, improving security and performance
  return {
    data: users,
    pagination: { page: 1, limit: 20, total: 100, totalPages: 5 },
  };
});
```

### Header Validation

```javascript
const AuthHeaders = Type.Object({
  authorization: Type.String({ pattern: '^Bearer .+$' }),
  'x-request-id': Type.Optional(Type.String({ format: 'uuid' })),
});

const ApiKeyHeaders = Type.Object({
  'x-api-key': Type.String({ minLength: 32 }),
});

fastify.get('/protected', {
  schema: {
    headers: AuthHeaders,
  },
}, async (request) => {
  const token = request.headers.authorization.replace('Bearer ', '');
  return { authenticated: true };
});
```

### Complete Route Example

```javascript
const { Type, Static } = require('@sinclair/typebox');

// Reusable schemas
const IdParam = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const Task = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  status: Type.Union([
    Type.Literal('todo'),
    Type.Literal('in_progress'),
    Type.Literal('done'),
  ]),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dueDate: Type.Optional(Type.String({ format: 'date' })),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const CreateTaskBody = Type.Omit(Task, ['id', 'createdAt', 'updatedAt']);
const UpdateTaskBody = Type.Partial(CreateTaskBody);

const TaskListQuery = Type.Object({
  status: Type.Optional(Type.Union([
    Type.Literal('todo'),
    Type.Literal('in_progress'),
    Type.Literal('done'),
  ])),
  priority: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

const Error = Type.Object({
  error: Type.String(),
  message: Type.String(),
});

// Routes
fastify.get('/tasks', {
  schema: {
    querystring: TaskListQuery,
    response: {
      200: Type.Object({
        tasks: Type.Array(Task),
        total: Type.Integer(),
      }),
    },
  },
}, listTasks);

fastify.post('/tasks', {
  schema: {
    body: CreateTaskBody,
    response: {
      201: Task,
      400: Error,
    },
  },
}, createTask);

fastify.get('/tasks/:id', {
  schema: {
    params: IdParam,
    response: {
      200: Task,
      404: Error,
    },
  },
}, getTask);

fastify.patch('/tasks/:id', {
  schema: {
    params: IdParam,
    body: UpdateTaskBody,
    response: {
      200: Task,
      404: Error,
    },
  },
}, updateTask);

fastify.delete('/tasks/:id', {
  schema: {
    params: IdParam,
    response: {
      204: Type.Null(),
      404: Error,
    },
  },
}, deleteTask);
```

## Schema Utilities

```javascript
const { Type } = require('@sinclair/typebox');

// Pick specific properties
const UserPublic = Type.Pick(UserSchema, ['id', 'name', 'email']);

// Omit properties
const UserWithoutPassword = Type.Omit(UserSchema, ['password']);

// Partial (all optional)
const UserPatch = Type.Partial(UserSchema);

// Required (all required)
const UserRequired = Type.Required(UserWithOptionals);

// Extending schemas
const AdminUser = Type.Intersect([
  UserSchema,
  Type.Object({
    permissions: Type.Array(Type.String()),
    department: Type.String(),
  }),
]);

// Reference/Definitions for shared schemas
const Definitions = Type.Object({
  user: UserSchema,
  address: AddressSchema,
});

// Composing with $ref (for OpenAPI compatibility)
const OrderSchema = Type.Object({
  id: Type.String(),
  customer: Type.Ref(UserSchema),
  items: Type.Array(Type.Object({
    product: Type.String(),
    quantity: Type.Integer(),
  })),
});
```

## Custom Validation with Formats

```javascript
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Fastify uses Ajv internally
// Add custom formats in Fastify setup

const fastify = require('fastify')({
  ajv: {
    customOptions: {
      allErrors: true,
      removeAdditional: true,
      useDefaults: true,
      coerceTypes: true,
    },
    plugins: [
      addFormats,
      function(ajv) {
        // Add custom format
        ajv.addFormat('phone', {
          type: 'string',
          validate: /^\+?[1-9]\d{1,14}$/,
        });

        // Add custom keyword
        ajv.addKeyword({
          keyword: 'isEven',
          type: 'number',
          validate: (schema, data) => data % 2 === 0,
        });
      },
    ],
  },
});

// Use custom format
const PhoneSchema = Type.String({ format: 'phone' });
```

## Error Messages

```javascript
// TypeBox generates standard JSON Schema
// Fastify/Ajv provides validation errors

fastify.setErrorHandler((error, request, reply) => {
  if (error.validation) {
    // error.validation contains array of validation errors
    // Example: [{ keyword: 'minLength', instancePath: '/name', message: 'must NOT have fewer than 1 characters' }]

    return reply.code(400).send({
      error: 'Validation Error',
      message: 'Request validation failed',
      details: error.validation.map(err => ({
        field: err.instancePath.replace('/', '') || err.params?.missingProperty,
        message: err.message,
        keyword: err.keyword,
      })),
    });
  }

  throw error;
});
```
