const jwt = require("jsonwebtoken");
const { ACCESS_JWT_SECRET, REFRESH_JWT_SECRET } = require("../models/constants");
const con = require("../models/db");
const { response } = require("./utils"); // Assuming circular dependency is fine or structure allows

const isAuthenticated = (req, res, next) => {
    // BYPASS FOR LOCAL TESTING WITHOUT DB
    req.user = { id: 2, email: 'ahmet@bitirme.com', fullName: 'Ahmet Yılmaz (Bypass)' };
    return next();

    let accessToken = req.cookies?.accessToken || req.headers["authorization"]?.split(" ")[1];

    if (!accessToken) {
        return response(res, 401, false, "No token provided.");
    }

    jwt.verify(accessToken, ACCESS_JWT_SECRET, (err, decoded) => {
        if (err) {
            if (err.name === "TokenExpiredError") {
                // Handle Auto-Refresh
                const refreshToken = req.cookies?.refreshToken;

                if (!refreshToken) {
                    return response(res, 401, false, "Access token expired and no refresh token provided.");
                }

                jwt.verify(refreshToken, REFRESH_JWT_SECRET, (refreshErr, refreshDecoded) => {
                    if (refreshErr) {
                        return response(res, 401, false, "Refresh token invalid or expired.");
                    }

                    // Check DB
                    const query = "SELECT * FROM refresh_tokens WHERE userID = ? AND token = ? AND isRevoked = 0";
                    con.query(query, [refreshDecoded.id, refreshToken], (dbErr, results) => {
                        if (dbErr || results.length === 0) {
                            return response(res, 401, false, "Refresh token revoked or not found.");
                        }

                        // Generate New Access Token
                        // We need user details (email, fullName) which might not be in refresh token (usually just ID).
                        // Let's fetch user details.
                        con.query("SELECT u.userID, ud.email, ud.fullName FROM users u LEFT JOIN userDetails ud ON u.userID = ud.userID WHERE u.userID = ?", [refreshDecoded.id], (uErr, uRes) => {
                            if (uErr || uRes.length === 0) {
                                return response(res, 401, false, "User not found during refresh.");
                            }
                            const user = uRes[0];
                            const newAccessToken = jwt.sign(
                                { id: user.userID, email: user.email, fullName: user.fullName },
                                ACCESS_JWT_SECRET,
                                { expiresIn: "15m" }
                            );

                            // Set New Cookie/Header
                            res.cookie("accessToken", newAccessToken, {
                                httpOnly: true,
                                secure: process.env.NODE_ENV === 'production',
                                sameSite: 'Lax',
                                maxAge: 15 * 60 * 1000
                            });

                            req.user = jwt.decode(newAccessToken); // Attach new decoded user
                            next();
                        });
                    });
                });
            } else {
                return response(res, 401, false, "Unauthorized! Invalid Token.");
            }
        } else {
            req.user = decoded;
            next();
        }
    });
};

const isHavePriv = (requiredPrivilege) => {
    return (req, res, next) => {
        // Ensure isAuthenticated was called and passed
        if (!req.user || !req.user.id) {
            return response(res, 401, false, "User not authenticated.");
        }

        const userID = req.user.id;

        const query = `
            SELECT p.privilegeName 
            FROM user_privileges up 
            JOIN privileges p ON up.privID = p.privilegeID 
            WHERE up.userID = ?
        `;

        con.query(query, [userID], (err, results) => {
            if (err) return response(res, 500, false, err.message);

            const privileges = results.map(r => r.privilegeName);

            req.user.privs = privileges;

            if (privileges.includes("Admin")) {
                return next();
            }

            if (!requiredPrivilege) {
                return next();
            }

            if (privileges.includes(requiredPrivilege)) {
                return next();
            }

            return response(res, 403, false, "Require " + requiredPrivilege + " Privilege!");
        });
    };
};

module.exports = {
    isAuthenticated,
    isHavePriv
};
