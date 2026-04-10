var mysql = require("mysql2");
const { DB_HOST, DB_USER, DB_PASSWORD, dbName } = require('./constants');

var con = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: dbName,
    port: 3306,
    // multipleStatements removed for security (SQL injection prevention)
    waitForConnections: true,
    connectionLimit: 50,
    queueLimit: 0,
    enableKeepAlive: true,
});

con.getConnection((err, connection) => {
    if (err) {
        console.error("Database Connection Failed:", err.message);
    } else {
        console.log("Connected to MySQL database!");
        connection.release();
    }
});

module.exports = con;
