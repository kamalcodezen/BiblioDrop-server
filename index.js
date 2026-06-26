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

// ডাটাবেজ কালেকশন মিডেলওয়্যার (প্রতি রিকোয়েস্টে অটো কালেকশন ইনজেক্ট করবে)
app.use(async (req, res, next) => {
    try {
        const db = await getDb();

        // কালেকশনগুলো এখানে ডিফাইন করা হলো
        req.db = {
            books: db.collection("books"),
            users: db.collection("user"),
            comments: db.collection("comments"),
            payments: db.collection("payments"),
            userSessions: db.collection("session"),
        };

        next();
    } catch (error) {
        res.status(500).json({ error: "Database connection failed via middleware" });
    }
});


// ================ middleware check================

// Verify authorization header and extract bearer token
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ success: false, message: "Unauthorized. No token provided." });
        }

        const token = authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized. No token provided." });
        }

        const query = { token: token };
        const session = await req.db.userSessions.findOne(query);

        //  সেশন না পাওয়া গেলে এখানেই আটকে jabe
        if (!session) {
            return res.status(401).json({ success: false, message: "Unauthorized. Invalid session." });
        }

        const userId = session?.userId;

        //আইডি স্ট্রিং হলে ওটাকে মঙ্গোডিবির ObjectId বানিয়ে নেওয়া 
        const userQuery = {
            _id: ObjectId.isValid(userId) ? new ObjectId(userId) : userId
        };
        const user = await req.db.users.findOne(userQuery);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // set user in request Object
        req.user = user;

        next();
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal Auth Error" });
    }
};

// librarian role check must be used after verifying token
const verifyLibrarian = async (req, res, next) => {
    if (req?.user?.role !== "librarian") {
        return res.status(403).json({ success: false, message: "Unauthorized. Only Librarian can access this route." });
    }
    next();
}

// admin role check must be used after verifying token
const verifyAdmin = async (req, res, next) => {
    if (req?.user?.role !== "admin") {
        return res.status(403).json({ success: false, message: "Unauthorized. Only Admin can access this route." });
    }
    next();
}

// user(Reader) role check must be used after verifying token
const verifyUser = async (req, res, next) => {
    if (req?.user?.role !== "user") {
        return res.status(403).json({ success: false, message: "Unauthorized. Only Reader can access this route." });
    }
    next();
}

// ================ middleware check================



// =============================================================
//                      Books Api feature
// =============================================================

// db te // all books get korche by status (Published & Checked Out)
app.get("/api/books/publishedBooks", async (req, res) => {
    try {
        const result = await req.db.books
            .find({
                status: { $in: ["Published", "Checked Out"] }
            })
            .toArray();

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
});

// book details by id 
app.get('/api/books/details/:id', async (req, res) => {
    const { id } = req.params;
    const result = await req.db.books.findOne({ _id: new ObjectId(id) });
    res.json(result);
});

// =================== Librarian =====================

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

//  librarian Id diye books get korche - Newest First with Dual Safety Check
app.get('/api/books', verifyToken, verifyLibrarian, async (req, res) => {
    try {
        const { librarianId } = req.query;

        if (req?.user?._id?.toString() !== librarianId?.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized. Only Librarian can access this route." });
        }

        //  আইডি স্ট্রিং হোক বা মঙ্গোডিবির ObjectId, দুই ক্যাটাগরিতেই যেন ডাটাবেজ ম্যাচ করতে পারে ভ
        const query = {
            $or: [
                { librarianId: librarianId },
                { librarianId: ObjectId.isValid(librarianId) ? new ObjectId(librarianId) : librarianId }
            ]
        };

        const result = await req.db.books
            .find(query)
            .toArray();

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});


// librarian id  all books status change 
app.patch('/api/books/:id', verifyToken, async (req, res) => {
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

// ================== Admin ================

// admin all books get
app.get('/api/books/allBooks', async (req, res) => {
    try {
        const result = await req.db.books
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

// admin gets all pending books
app.get('/api/books/pendingBooks', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await req.db.books.find({ status: "Pending Approval" }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

// admin approve pending book status by id
app.patch('/api/books/approveStatus/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const targetStatus = "Published";

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
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

// admin book status check kore status update korbe (publish/unpublish)
app.patch('/api/books/updateStatus/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const targetStatus = ["Unpublished", "Published"];

        if (!targetStatus.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const result = await req.db.books.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: status } }
        );
        res.json({
            success: true,
            message: `Book status successfully updated to ${status}!`,
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});



//  অ্যাডমিন কুইক স্ট্যাটাস কাউন্ট এপিআই রুট 
app.get('/api/admin/stats', async (req, res) => {
    try {
        const totalUsers = await req.db.users.countDocuments({});
        const totalBooks = await req.db.books.countDocuments({});
        const totalDeliveries = await req.db.payments.countDocuments({ status: "Delivered" });

        // টোটাল রেভিনিউ যোগ করার জন্য মঙ্গোডিবি এগ্রিগেশন পাইপলাইন 
        const revenueResult = await req.db.payments.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: "$amount" }
                }
            }
        ]).toArray();

        const totalRevenue = revenueResult[0]?.total || 0;

        res.json({
            success: true,
            stats: { totalUsers, totalBooks, totalDeliveries, totalRevenue }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// পাই-চার্টের জন্য ক্যাটেগরি অনুযায়ী বই গোনার এপিআই 
app.get('/api/admin/book-categories', async (req, res) => {
    try {

        const categoryData = await req.db.books.aggregate([
            {
                $group: {
                    _id: "$category",
                    value: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    name: "$_id",
                    value: 1
                }
            }
        ]).toArray();

        res.json({ success: true, categoryData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});







//================== Users / Comments Api =====================

// user role update by admin
app.patch('/api/users/updateRole/:id', async (req, res) => {
    const { id } = req.params;
    const { userRole } = req.body;
    try {
        const result = await req.db.users.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: userRole } }
        );
        res.json({
            success: true,
            message: `User role successfully updated to ${userRole}!`,
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

// user er sob data get korchi joto user ache tader list
app.get("/api/users", async (req, res) => {
    try {
        const userCollection = await req.db.users;
        const users = await userCollection
            .find({})
            .project({
                password: 0,
                salt: 0,
                hashedPassword: 0,
                textPassword: 0
            })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json({
            success: true,
            count: users.length,
            users: users,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal Server Error. Failed to fetch user collection.",
            error: error.message,
        });
    }
});

// user delete by admin
app.delete('/api/users/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await req.db.users.deleteOne({ _id: new ObjectId(id) });
        res.json({
            success: true,
            message: `User has been successfully deleted!`,
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

// user id diye tar nijer comment get korchi
app.get('/api/books/comments/:userId', verifyToken, verifyUser, async (req, res) => {
    const { userId } = req.params;

    if (req?.user?._id?.toString() !== userId?.toString()) {
        return res.status(403).json({ success: false, message: "Unauthorized. Only Reader can access this route." });
    }


    try {
        const result = await req.db.comments.find({ userId: userId }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

// user comments add post
app.post('/api/users/comments', async (req, res) => {
    try {
        const data = req.body;
        const commentData = {
            ...data,
            createdAt: new Date()
        };
        const result = await req.db.comments.insertOne(commentData);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});

//   book id diye comment get korchi
app.get('/api/books/comments', async (req, res) => {

    try {
        const query = {}

        if (req.query.bookId) {
            query.bookId = req.query.bookId
        }
        const result = await req.db.comments.find(query).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});





// User comment edit/update by commentId
app.patch('/api/users/comments/edit/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;

        const result = await req.db.comments.updateOne(
            { _id: new ObjectId(id) },
            { $set: { comment: comment, updatedAt: new Date() } }
        );

        res.json({
            success: true,
            message: "Comment updated successfully in database!",
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error during comment update"
        });
    }
});

// User comments Delete by id
app.delete('/api/users/comments/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await req.db.comments.deleteOne({ _id: new ObjectId(id) });
        res.json({
            success: true,
            message: "Comment has been successfully deleted!",
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error during comment delete"
        });
    }
});

//================== payments =====================
app.post('/api/payments', async (req, res) => {
    try {
        const { sessionId, bookId, bookTitle, bookCover, userId, userEmail, librarianId, librarianEmail, amount } = req.body;
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const currentMonth = monthNames[new Date().getMonth()];

        const paymentData = {
            transactionId: sessionId,
            bookId,
            bookTitle,
            bookCover,
            userId,
            userEmail,
            librarianId,
            librarianEmail,
            amount,
            month: currentMonth,
            status: "Pending",
            createdAt: new Date()
        };

        const isExists = await req.db.payments.findOne({ transactionId: sessionId });

        if (isExists) {
            return res.status(400).json({
                success: false,
                message: "Payment already exists!"
            });
        }

        await req.db.payments.insertOne(paymentData);

        await req.db.books.updateOne(
            { _id: new ObjectId(bookId) },
            {
                $set: { status: "Checked Out" },
                $inc: { requests: 1 } //payment success hole rq barbe
            }
        );

        res.json({
            success: true,
            message: "Payment successfully created!",
            paymentData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// all payments data get
app.get('/api/payments', async (req, res) => {
    try {
        const result = await req.db.payments.find({}).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
});


// Get payment history by user email
app.get('/api/payments/user/:email', async (req, res) => {
    const { email } = req.params;

    try {
        const result = await req.db.payments
            .find({ userEmail: email })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
});

// user payments data get by userEmail
app.get('/api/payments/librarian/:email', async (req, res) => {
    try {
        const { email } = req.params;

        const result = await req.db.payments.find({ librarianEmail: email }).sort({ createdAt: -1 }).toArray();
        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});


// ইউজার পেমেন্ট করা বুক রিটার্ন স্ট্যাটাস আপডেট রুট ভাই
app.patch('/api/payments/return/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { currentStatus } = req.body;

        if (!paymentId) {
            return res.status(400).json({ success: false, message: "Payment ID is required." });
        }

        const targetStatus = currentStatus === "Delivered"
            ? "Return Requested"
            : currentStatus === "Return Requested"
                ? "Returned"
                : currentStatus;

        // status update
        const result = await req.db.payments.updateOne(
            { _id: new ObjectId(paymentId) },
            { $set: { status: targetStatus } }
        );

        //  যদি স্ট্যাটাস সাকসেসফুলি 'Returned' হয়ে যায়, তবে বই আবার 'Published' হবে ভাই
        if (targetStatus === "Returned") {
            const paymentDoc = await req.db.payments.findOne({ _id: new ObjectId(paymentId) });

            if (paymentDoc?.bookId) {
                await req.db.books.updateOne(
                    { _id: new ObjectId(paymentDoc.bookId) },
                    { $set: { status: "Published" } } // বইটি লাইব্রেরির তাকে আবার পাবলিশ করা হলো
                );
            }
        }

        res.json({
            success: true,
            message: `Status successfully updated to ${targetStatus}`,
            result
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "An unexpected internal server error occurred."
        });
    }
});


// librarian delivery status update
app.patch('/api/payments/updateStatus/:deliveryId', async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { currentStatus } = req.body;

        if (!deliveryId) {
            return res.status(400).json({ success: false, message: "Delivery ID is required." });
        }

        //status check
        const targetStatus = currentStatus === "Pending"
            ? "Dispatched"
            : currentStatus === "Dispatched"
                ? "Delivered"
                : currentStatus === "Delivered"
                    ? "Return Requested"
                    : currentStatus === "Return Requested"
                        ? "Returned"
                        : currentStatus;

        // ডাটাবেজের payments কালেকশনে নতুন টার্গেট স্ট্যাটাসটি আপডেট করা হলো ভাই
        const result = await req.db.payments.updateOne(
            { _id: new ObjectId(deliveryId) },
            { $set: { status: targetStatus } }
        );

        //  যদি স্ট্যাটাস ফাইনাল 'Returned' হয়ে যায়, তবে মেইন বই আবার 'Published' হবে ভাই
        if (targetStatus === "Returned") {
            const paymentDoc = await req.db.payments.findOne({ _id: new ObjectId(deliveryId) });
            if (paymentDoc?.bookId) {
                await req.db.books.updateOne(
                    { _id: new ObjectId(paymentDoc.bookId) },
                    { $set: { status: "Published" } }
                );
            }
        }

        res.json({
            success: true,
            message: `Status successfully updated to ${targetStatus}!`,
            result
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
});










// ===============================





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

module.exports = app;