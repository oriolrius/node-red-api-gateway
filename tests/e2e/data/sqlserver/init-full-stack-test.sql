-- Full Stack Integration Test Database Initialization Script
-- This script creates the testdb database and products table for e2e testing
--
-- Usage: Execute via sqlcmd or mssql Node.js package after SQL Server starts
--   sqlcmd -S localhost -U sa -P 'DevPassword123!' -i init-full-stack-test.sql

-- Create database if it doesn't exist
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'testdb')
BEGIN
    CREATE DATABASE testdb;
END
GO

USE testdb;
GO

-- Create products table if it doesn't exist
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='products' AND xtype='U')
BEGIN
    CREATE TABLE products (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(200) NOT NULL,
        category NVARCHAR(50) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        stock INT DEFAULT 0,
        created_at DATETIME2 DEFAULT GETUTCDATE(),
        updated_at DATETIME2 DEFAULT GETUTCDATE()
    );

    -- Create index on category for filtering
    CREATE INDEX IX_products_category ON products(category);
END
GO

-- Clear existing data for idempotent test runs
DELETE FROM products;
GO

-- Reset identity to 1
DBCC CHECKIDENT ('products', RESEED, 0);
GO

-- Insert 10 sample products
INSERT INTO products (name, category, price, stock) VALUES
    ('Laptop Pro 15', 'electronics', 1299.99, 15),
    ('Wireless Mouse', 'electronics', 29.99, 50),
    ('USB-C Hub', 'electronics', 49.99, 30),
    ('Mechanical Keyboard', 'electronics', 149.99, 25),
    ('Coffee Maker', 'appliances', 89.99, 20),
    ('Standing Desk', 'furniture', 499.99, 10),
    ('Monitor 27"', 'electronics', 349.99, 18),
    ('Webcam HD', 'electronics', 79.99, 40),
    ('Desk Lamp', 'furniture', 39.99, 35),
    ('Noise Canceling Headphones', 'electronics', 299.99, 22);
GO

-- Verify data was inserted
SELECT COUNT(*) AS product_count FROM products;
GO

PRINT 'Full stack test database initialized successfully';
GO
