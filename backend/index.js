const express = require('express');
const mysql = require('mysql2');

const app = express();
const port = 5000;

// Conexión a la base de datos MySQL
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'trackii_app1',
  password: 'Trackii2026!',
  database: 'trendingStatus', // Este será el nombre de la base de datos cuando la crees
  port: 3306,
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to MySQL database!');
});

// Endpoint de prueba
app.get('/', (req, res) => {
  res.send('Hello, this is your backend!');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
