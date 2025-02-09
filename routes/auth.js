require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { getDBPool } = require("../db"); // Importing DB connection function

const SECRET_KEY = process.env.SECRET_KEY || "DISPATCH123";
router.post("/register", async (req, res) => {
    const { username, Password, Email, Roles, Permission } = req.body;

    try {
        const localPool = getDBPool(false); 
        const hashedPassword = await bcrypt.hash(Password, 10);
        console.log("🔑 Password hashed");

        const userQuery = `INSERT INTO tblusers
            (username, Email, Password, Roles, Permission, Created, StoreName) 
            VALUES (?, ?, ?, ?, ?, NOW(), ?)`;

        let localUserId = null, cloudUserId = null;

        // ✅ Try inserting into Local DB
        try {
            console.log("📤 Running LOCAL DB Query...");
            const [userResultLocal] = await localPool.query(userQuery, [username, Email, hashedPassword, Roles, Permission, null]);
            localUserId = userResultLocal.insertId;
            console.log("✅ Inserted into LOCAL DB:", localUserId);
        } catch (localError) {
            console.error("❌ Error in Local DB:", localError.message);
            return res.status(500).json({ message: "Error in Local DB", error: localError.message });
        }

    
        res.status(201).json({
            message: "User created successfully",
            localUserId
        });

    } catch (error) {
        console.error("❌ Error in Registration API:", error.message);
        res.status(500).json({ message: "Error creating user", error: error.message });
    }
});



// ✅ User Login API
router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const pool = getDBPool(false); // Default to local DB
        const usersTable = process.env.DB_ENV === "cloud" ? "tbl_store_users" : "tblusers";

        // ✅ Find user
        const [users] = await pool.query(`SELECT * FROM ${usersTable} WHERE username = ?`, [username]);
        if (users.length === 0) return res.status(400).json({ message: "User not found" });

        const user = users[0];

        // ✅ Compare password
        const isMatch = await bcrypt.compare(password, user.Password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

        // ✅ Generate JWT Token
        const token = jwt.sign(
            { userId: user.id, roles: user.Roles, store: user.StoreName },
            SECRET_KEY,
            { expiresIn: "1d" }
        );

        res.json({ token, user: { id: user.id, username: user.username, roles: user.Roles, store: user.StoreName } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error logging in", error: error.message });
    }
});

module.exports = router;
