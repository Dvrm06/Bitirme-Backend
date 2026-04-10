require('dotenv').config();

const ACCESS_JWT_SECRET = process.env.ACCESS_JWT_SECRET || "access_secret_key_123";
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET || "refresh_secret_key_123";

// Fail-hard if JWT secrets are defaults in production
if (process.env.NODE_ENV === 'production') {
    if (ACCESS_JWT_SECRET === "access_secret_key_123" || REFRESH_JWT_SECRET === "refresh_secret_key_123") {
        console.error("FATAL: JWT secrets must be set via environment variables in production!");
        console.error("Set ACCESS_JWT_SECRET and REFRESH_JWT_SECRET in your .env file.");
        process.exit(1);
    }
}

module.exports = {
    DB_HOST: process.env.DB_HOST || "localhost",
    DB_USER: process.env.DB_USER || "root",
    DB_PASSWORD: process.env.DB_PASSWORD || "",
    dbName: process.env.DB_NAME || "bitirme",
    PORT: process.env.PORT || 8001,
    ACCESS_JWT_SECRET,
    REFRESH_JWT_SECRET
};
