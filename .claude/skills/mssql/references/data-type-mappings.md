# SQL Server Data Type Mappings

Complete reference for mapping SQL Server data types to JavaScript types using the `mssql` package.

## Numeric Types

### Integer Types

| SQL Server | mssql Constant | JS Type | Range | Notes |
|------------|----------------|---------|-------|-------|
| `TINYINT` | `sql.TinyInt` | `number` | 0 to 255 | Unsigned 8-bit |
| `SMALLINT` | `sql.SmallInt` | `number` | -32,768 to 32,767 | 16-bit |
| `INT` | `sql.Int` | `number` | -2^31 to 2^31-1 | 32-bit |
| `BIGINT` | `sql.BigInt` | `string` | -2^63 to 2^63-1 | Returns string to preserve precision |

```javascript
// Integer examples
request.input('tinyVal', sql.TinyInt, 255);
request.input('smallVal', sql.SmallInt, 32000);
request.input('intVal', sql.Int, 2147483647);
request.input('bigVal', sql.BigInt, '9223372036854775807'); // Use string for BIGINT

// Reading BIGINT values
const result = await request.query('SELECT big_column FROM table');
const bigValue = BigInt(result.recordset[0].big_column); // Convert string to BigInt
```

### Decimal/Numeric Types

| SQL Server | mssql Constant | JS Type | Notes |
|------------|----------------|---------|-------|
| `DECIMAL(p,s)` | `sql.Decimal(p, s)` | `number` | Precision 1-38, scale 0-p |
| `NUMERIC(p,s)` | `sql.Numeric(p, s)` | `number` | Same as DECIMAL |
| `MONEY` | `sql.Money` | `number` | 4 decimal places |
| `SMALLMONEY` | `sql.SmallMoney` | `number` | 4 decimal places, smaller range |

```javascript
// Decimal examples
request.input('price', sql.Decimal(10, 2), 1234.56);
request.input('rate', sql.Numeric(5, 4), 0.0525);
request.input('amount', sql.Money, 99999.9999);

// Precision considerations
// For financial calculations, use strings and handle precision in application
request.input('preciseAmount', sql.Decimal(18, 6), parseFloat('123456.789012'));
```

### Floating Point Types

| SQL Server | mssql Constant | JS Type | Notes |
|------------|----------------|---------|-------|
| `FLOAT` | `sql.Float` | `number` | 8-byte floating point |
| `REAL` | `sql.Real` | `number` | 4-byte floating point |

```javascript
// Float examples
request.input('temperature', sql.Float, 98.6);
request.input('percentage', sql.Real, 0.15);

// Note: Floating point has precision limitations
// Avoid for financial data, use DECIMAL instead
```

## String Types

### Character Types

| SQL Server | mssql Constant | JS Type | Notes |
|------------|----------------|---------|-------|
| `CHAR(n)` | `sql.Char(n)` | `string` | Fixed length, 1-8000 |
| `VARCHAR(n)` | `sql.VarChar(n)` | `string` | Variable length, 1-8000 |
| `VARCHAR(MAX)` | `sql.VarChar(sql.MAX)` | `string` | Up to 2GB |
| `TEXT` | `sql.Text` | `string` | Legacy, use VARCHAR(MAX) |

### Unicode Character Types

| SQL Server | mssql Constant | JS Type | Notes |
|------------|----------------|---------|-------|
| `NCHAR(n)` | `sql.NChar(n)` | `string` | Fixed length Unicode, 1-4000 |
| `NVARCHAR(n)` | `sql.NVarChar(n)` | `string` | Variable length Unicode, 1-4000 |
| `NVARCHAR(MAX)` | `sql.NVarChar(sql.MAX)` | `string` | Up to 2GB Unicode |
| `NTEXT` | `sql.NText` | `string` | Legacy, use NVARCHAR(MAX) |

```javascript
// String examples
request.input('code', sql.Char(10), 'ABC');        // Padded to 10 chars
request.input('name', sql.VarChar(100), 'John Doe');
request.input('description', sql.VarChar(sql.MAX), longText);

// Unicode strings (for international characters)
request.input('unicodeName', sql.NVarChar(100), '日本語テキスト');
request.input('content', sql.NVarChar(sql.MAX), unicodeContent);

// When to use NVARCHAR vs VARCHAR:
// - Use NVARCHAR for user-generated content
// - Use NVARCHAR for international applications
// - Use VARCHAR for ASCII-only data (codes, identifiers)
```

## Date and Time Types

| SQL Server | mssql Constant | JS Type | Precision | Notes |
|------------|----------------|---------|-----------|-------|
| `DATE` | `sql.Date` | `Date` | Day | Date only, no time |
| `TIME` | `sql.Time` | `Date` | 100ns | Time only, no date |
| `DATETIME` | `sql.DateTime` | `Date` | 3.33ms | Legacy, range 1753-9999 |
| `DATETIME2` | `sql.DateTime2` | `Date` | 100ns | Preferred, range 0001-9999 |
| `DATETIMEOFFSET` | `sql.DateTimeOffset` | `Date` | 100ns | Includes timezone |
| `SMALLDATETIME` | `sql.SmallDateTime` | `Date` | 1min | Limited range |

```javascript
// Date/time examples
const now = new Date();

request.input('dateOnly', sql.Date, now);           // 2024-01-15
request.input('timeOnly', sql.Time, now);           // 14:30:00.1234567
request.input('legacyDt', sql.DateTime, now);       // 2024-01-15 14:30:00.123
request.input('preciseDt', sql.DateTime2, now);     // 2024-01-15 14:30:00.1234567
request.input('withTz', sql.DateTimeOffset, now);   // 2024-01-15 14:30:00.1234567 +00:00

// Time with specific scale (0-7)
request.input('time3', sql.Time(3), now);           // 14:30:00.123

// Creating dates
request.input('specificDate', sql.Date, new Date('2024-06-15'));
request.input('specificTime', sql.DateTime2, new Date('2024-06-15T10:30:00Z'));

// Timezone handling
// JavaScript Date is always UTC internally
// DateTimeOffset preserves timezone info
const utcDate = new Date('2024-06-15T10:30:00Z');
const localDate = new Date('2024-06-15T10:30:00');  // Local timezone
```

## Binary Types

| SQL Server | mssql Constant | JS Type | Notes |
|------------|----------------|---------|-------|
| `BINARY(n)` | `sql.Binary(n)` | `Buffer` | Fixed length, 1-8000 |
| `VARBINARY(n)` | `sql.VarBinary(n)` | `Buffer` | Variable length, 1-8000 |
| `VARBINARY(MAX)` | `sql.VarBinary(sql.MAX)` | `Buffer` | Up to 2GB |
| `IMAGE` | `sql.Image` | `Buffer` | Legacy, use VARBINARY(MAX) |

```javascript
// Binary examples
const buffer = Buffer.from('binary data');
const fileBuffer = fs.readFileSync('image.png');

request.input('fixedBin', sql.Binary(16), buffer);
request.input('varBin', sql.VarBinary(1000), buffer);
request.input('largeFile', sql.VarBinary(sql.MAX), fileBuffer);

// Hash values
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update('data').digest();
request.input('hash', sql.Binary(32), hash);

// Reading binary data
const result = await request.query('SELECT file_data FROM Files WHERE id = 1');
const fileData = result.recordset[0].file_data; // Buffer
fs.writeFileSync('output.bin', fileData);
```

## Boolean Type

| SQL Server | mssql Constant | JS Type | Notes |
|------------|----------------|---------|-------|
| `BIT` | `sql.Bit` | `boolean` | 0, 1, or NULL |

```javascript
// Boolean examples
request.input('active', sql.Bit, true);
request.input('deleted', sql.Bit, false);
request.input('unknown', sql.Bit, null);

// Reading BIT values
const result = await request.query('SELECT active FROM Users');
const isActive = result.recordset[0].active; // true, false, or null
```

## Special Types

### UNIQUEIDENTIFIER (GUID)

```javascript
// GUID/UUID
request.input('id', sql.UniqueIdentifier, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

// Generate new GUID
const { v4: uuidv4 } = require('uuid');
request.input('newId', sql.UniqueIdentifier, uuidv4());

// NEWID() in SQL Server generates GUIDs
await request.query(`
  INSERT INTO Items (id, name) VALUES (NEWID(), @name)
`);
```

### XML

```javascript
// XML data
const xmlData = '<root><item id="1">Value</item></root>';
request.input('xmlDoc', sql.Xml, xmlData);

// Query XML columns
const result = await request.query(`
  SELECT xml_column.value('(/root/item/@id)[1]', 'INT') as itemId
  FROM XmlTable
`);
```

### Spatial Types

```javascript
// Geography (for GPS coordinates, etc.)
const geoJson = {
  type: 'Point',
  coordinates: [-122.4194, 37.7749] // [longitude, latitude]
};
request.input('location', sql.Geography, JSON.stringify(geoJson));

// Insert using SQL Server geography functions
await request.query(`
  INSERT INTO Locations (name, location)
  VALUES (@name, geography::Point(@lat, @lon, 4326))
`);

// Geometry (planar coordinates)
request.input('shape', sql.Geometry, geometryWkt);
```

### Table-Valued Parameters (TVP)

```javascript
// Define TVP structure
const tvp = new sql.Table();
tvp.columns.add('id', sql.Int);
tvp.columns.add('name', sql.NVarChar(100));
tvp.columns.add('quantity', sql.Int);

// Add rows
tvp.rows.add(1, 'Item A', 10);
tvp.rows.add(2, 'Item B', 20);
tvp.rows.add(3, 'Item C', 30);

// Use in query (requires User-Defined Table Type in SQL Server)
request.input('items', tvp);
const result = await request.execute('ProcessItems');

// SQL Server side:
// CREATE TYPE ItemTableType AS TABLE (
//   id INT,
//   name NVARCHAR(100),
//   quantity INT
// );
//
// CREATE PROCEDURE ProcessItems
//   @items ItemTableType READONLY
// AS
// BEGIN
//   INSERT INTO Orders (product_id, product_name, qty)
//   SELECT id, name, quantity FROM @items;
// END
```

## Type Inference

When you don't specify a type, mssql attempts to infer it:

```javascript
// These use automatic type inference
request.input('num', 42);           // Inferred as Int
request.input('str', 'hello');      // Inferred as NVarChar
request.input('bool', true);        // Inferred as Bit
request.input('date', new Date());  // Inferred as DateTime
request.input('buf', Buffer.from('data')); // Inferred as VarBinary

// Explicit types are recommended for:
// - Specific precision requirements (DECIMAL, VARCHAR length)
// - Output parameters
// - Stored procedure parameters
// - Performance-critical queries (avoids implicit conversions)
```

## Common Conversion Patterns

### String to Date

```javascript
// ISO format strings work directly
request.input('date', sql.DateTime2, new Date('2024-06-15T10:30:00Z'));

// Parse other formats
const parseDate = (str) => {
  // MM/DD/YYYY format
  const [month, day, year] = str.split('/');
  return new Date(year, month - 1, day);
};
request.input('parsedDate', sql.Date, parseDate('06/15/2024'));
```

### Number Precision

```javascript
// Preserve decimal precision
const decimalValue = '123.456789';
request.input('precise', sql.Decimal(18, 6), parseFloat(decimalValue));

// For currency, use integer cents
const dollars = 99.99;
const cents = Math.round(dollars * 100);
request.input('amountCents', sql.Int, cents);
```

### Null Handling

```javascript
// Explicit null
request.input('optionalField', sql.VarChar(100), null);

// Conditional null
const value = condition ? 'value' : null;
request.input('conditionalField', sql.VarChar(100), value);

// Check for null in results
const result = await request.query('SELECT nullable_col FROM table');
if (result.recordset[0].nullable_col === null) {
  // Handle null
}
```
