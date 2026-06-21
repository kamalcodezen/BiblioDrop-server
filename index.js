const express = require('express');
const cors = require('cors');
const dotenv = require("dotenv");

dotenv.config();

const { ObjectId } = require("mongodb");
const { getDb } = require('./db');
const app = express();
const port = process.env.PORT || 8000;


app.use(cors({
    origin: ["http://localhost:3000"],
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

// librarian all books status change 
app.patch('/api/books/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { currentStatus } = req.body;

        if (currentStatus === "Pending Approval") {
            return res.status(400).json({ success: false, message: " Waiting for Admin approval." });
        }

        const targetStatus = currentStatus === "Published" ? "Unpublished" : "Published";

        const result = await req.db.books.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: targetStatus } }
        );
        res.json({
            success: true,
            message: `Book status successfully updated to ${targetStatus}! `,
            result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// librarian book edit by id (update)
app.patch('/api/books/edit/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const bookData = req.body;

        // req.body থেকে যদি কোনোভাবে _id আসে, সেটা ডিলিট করে দেওয়া হলো
        // কারণ মঙ্গোডিবিতে এক্সিস্টিং ডকুমেন্টের _id চেঞ্জ বা $set করা নিষিদ্ধ
        delete bookData._id;


        if (bookData.fee) {
            bookData.fee = Number(bookData.fee) || 0;
        }
        const result = await req.db.books.updateOne(
            { _id: new ObjectId(id) },
            { $set: bookData }
        );

        res.json({
            success: true,
            message: `Book details updated successfully to "${bookData.title || 'new title'}"!`,
            result
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});


// librarian book Delete by id
app.delete('/api/books/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await req.db.books.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 1) {
            res.json({
                success: true,
                message: "Book has been successfully wiped from inventory!",
                result
            });
        } else {
            res.status(404).json({
                success: false,
                message: "Book not found or already deleted from the system."
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});




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