-- Insert User
INSERT INTO users (email, password, role, lang_code,firstname,lastname) VALUES
('admin@example.com', '$2a$10$6ew/Mx7CgzJuAqJ0o8hvOukno6tdFTc6WQeWPSS79gv.UcXR23jSu','ADMIN', 'en','admin',''),
('user@example.com', '$2a$10$6ew/Mx7CgzJuAqJ0o8hvOukno6tdFTc6WQeWPSS79gv.UcXR23jSu', 'USER','fa','cashier','1');

-- Insert Log
INSERT INTO logs (source, destination, protocol, details) VALUES
    ('Pakistan', 'Israil', 'HTTP','Some one in middle of comunication')