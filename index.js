const express = require('express');
const cors = require('cors');
const dotenv = require("dotenv");

dotenv.config();

const { getDb } = require('./db');
const app = express();
const port = process.env.PORT || 8000;

// গ্লোবাল মিডেলওয়্যারসমূহ
app.use(cors({
    origin: ["http://localhost:3000"], // নেক্সট.জিএস ফ্রন্টএন্ড পোর্ট
    credentials: true
}));
app.use(express.json());

//  ডাটাবেজ কালেকশন মিডেলওয়্যার (প্রতি রিকোয়েস্টে অটো কালেকশন ইনজেক্ট করবে)
app.use(async (req, res, next) => {
    try {
        const db = await getDb();

        //   কালেকশনগুলো এখানে ডিফাইন করা হলো
        req.db = {
            // books: db.collection("books"),
            books: db.collection("books"),

        };

        next();
    } catch (error) {
        res.status(500).json({ error: "Database connection failed via middleware" });
    }
});

// =============================================================
//  কোড লেখার সময় req.db.collectionName diye likhbo
// =============================================================

// =============================================================
//             Books Api feature
// =============================================================

// librarian book post korche 
app.post('/api/books', async (req, res) => {
    try {
        const bookData = req.body;
        const finalBookObj = {
            ...bookData,
            fee: Number(bookData.fee) || 0,
            status: "Pending Approval",
            requests: 0,
            createdAt: new Date()
        };
        const result = await req.db.books.insertOne(finalBookObj);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            message: error.message || "An unexpected internal server error occurred."
        });
    }
});

// librarian Id diye books get korche
app.get('/api/books', async (req, res) => {
    const query = {}
    if (req.query.librarianId) {
        query.librarianId = req.query.librarianId;
    }
    const result = await req.db.books.find(query).toArray();
    res.json(result);

})






// =======================================================================

// বেস হেলথ চেক রুট
app.get('/', (req, res) => {
    res.send('ShelfParcel Serverless-Ready Core Engine is running active and clean!');
});

// লোকাল পিসির ডেভলপমেন্ট রানার কন্ট্রোল
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(` Back-end Terminal active on local port http://localhost:${port}`);
    });
}

module.exports = app; // Vercel হোস্টিংয়ের জন্য রেডি এক্সপোর্ট