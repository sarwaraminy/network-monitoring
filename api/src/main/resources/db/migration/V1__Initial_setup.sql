-- Users table: Stores user information.
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    password VARCHAR(100) NOT NULL,
    email VARCHAR(200) UNIQUE,
    role VARCHAR(50) NOT NULL,   -- e.g., admin, cashier, etc.
    lang_code VARCHAR(10) NOT NULL,
    firstname VARCHAR(50) NOT NULL,
    lastname VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Log table: Stores threat information.
CREATE TABLE logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sourceip VARCHAR(200) NOT NULL,
    sourcemac VARCHAR(2000) NULL,
    destinationip VARCHAR(200) NOT NULL,
    destinationmac VARCHAR(2000) NULL,
    protocol VARCHAR(100) NOT NULL,
    ipversion VARCHAR(100) NULL,
    details VARCHAR(2000) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


