require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const path = require('path');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const crypto = require('crypto');
const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

const app = express();

// 连接 MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const conn = mongoose.createConnection(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// 初始化 GridFS
let gfs;
conn.once('open', () => {
    gfs = new mongoose.mongo.GridFSBucket(conn.db, {
        bucketName: 'uploads'
    });
    console.log('GridFS initialized');
});

// 原有的 Schema 定义保持不变
const allocationSchema = new mongoose.Schema({
    group_text: String,
    productCode: String,
    allocations: [{
        cn: String,
        quantity: Number
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const submissionSchema = new mongoose.Schema({
    cn: String,
    group_text: String,
    pushType: String,
    pushDetails: [{
        productCode: String,
        quantity: Number
    }],
    selfColdDetails: [{
        productCode: String,
        quantity: Number
    }],
    pushImages: [String],  // 这里存 GridFS 的文件 ID
    selfColdImages: [String],
    status: { type: String, default: '待审核' },
    createdAt: { type: Date, default: Date.now }
});

const rateSchema = new mongoose.Schema({
    productCode: { type: String, required: true, unique: true },
    rate: { type: Number, required: true },
    description: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Allocation = mongoose.model('Allocation', allocationSchema);
const Submission = mongoose.model('Submission', submissionSchema);
const Rate = mongoose.model('Rate', rateSchema);

// ============= 初始化默认捆率 =============
async function initDefaultRates() {
    const defaultRates = [
        { productCode: 'A1', rate: 2, description: '1k2' },
        { productCode: 'C2', rate: 2, description: '1k2' },
        { productCode: 'C4', rate: 2, description: '1k2' },
        { productCode: 'C8', rate: 2, description: '1k2' },
        { productCode: 'B15', rate: 2, description: '1k2' },
        { productCode: 'A4', rate: 1, description: '1k1' },
        { productCode: 'B5', rate: 1, description: '1k1' },
        { productCode: 'A10', rate: 1, description: '1k1' },
        { productCode: 'C12', rate: 1, description: '1k1' },
        { productCode: 'B16', rate: 1, description: '1k1' },
        { productCode: 'C14', rate: 1, description: '1k1' },
        { productCode: 'C7', rate: 1, description: '1k1' }
    ];

    for (const item of defaultRates) {
        await Rate.findOneAndUpdate(
            { productCode: item.productCode },
            { $setOnInsert: item },
            { upsert: true }
        );
    }
    console.log('默认捆率初始化完成');
}

// 在连接后初始化捆率
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('MongoDB connected successfully');
    initDefaultRates();
});

// ============= 中间件配置 =============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============= GridFS 存储配置 =============
const storage = new GridFsStorage({
    url: MONGODB_URI,
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(16, (err, buf) => {
                if (err) {
                    return reject(err);
                }
                const filename = buf.toString('hex') + path.extname(file.originalname);
                const fileInfo = {
                    filename: filename,
                    bucketName: 'uploads'
                };
                resolve(fileInfo);
            });
        });
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ============= 图片获取路由 =============
app.get('/api/image/:filename', (req, res) => {
    if (!gfs) {
        return res.status(503).send('GridFS not ready');
    }

    gfs.find({ filename: req.params.filename }).toArray((err, files) => {
        if (!files || files.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        const readstream = gfs.openDownloadStreamByName(req.params.filename);
        readstream.pipe(res);
    });
});

// ============= 计算最终捆数函数 =============
async function calculateFinalBundles(member, allocations) {
    console.log('\n=== 开始计算 ' + member.cn + ' 的最终捆数 ===');
    console.log('团员提交组别:', member.group);
    console.log('推车类型:', member.pushType);
    // ... 其余代码保持不变
    // 注意：这个函数需要从数据库获取捆率
    const rates = await Rate.find();
    const bundleRates = {};
    rates.forEach(r => {
        bundleRates[r.productCode] = r.rate;
    });

    // ... 其余计算逻辑
}

// ============= API路由 =============

// 团员提交（使用 GridFS）
app.post('/api/submit', upload.fields([
    { name: 'pushImages', maxCount: 10 },
    { name: 'selfColdImages', maxCount: 10 }
]), async function(req, res) {
    try {
        var cn = req.body.cn;
        var group = req.body.group;
        var pushType = req.body.pushType;

        var pushDetails = [];
        if (req.body.pushProductCode) {
            if (Array.isArray(req.body.pushProductCode)) {
                for (var i = 0; i < req.body.pushProductCode.length; i++) {
                    if (req.body.pushProductCode[i] && req.body.pushQuantity[i]) {
                        pushDetails.push({
                            productCode: req.body.pushProductCode[i],
                            quantity: parseInt(req.body.pushQuantity[i])
                        });
                    }
                }
            } else if (req.body.pushProductCode && req.body.pushQuantity) {
                pushDetails.push({
                    productCode: req.body.pushProductCode,
                    quantity: parseInt(req.body.pushQuantity)
                });
            }
        }

        var selfColdDetails = [];
        if (req.body.coldProductCode) {
            if (Array.isArray(req.body.coldProductCode)) {
                for (var i = 0; i < req.body.coldProductCode.length; i++) {
                    if (req.body.coldProductCode[i] && req.body.coldQuantity[i]) {
                        selfColdDetails.push({
                            productCode: req.body.coldProductCode[i],
                            quantity: parseInt(req.body.coldQuantity[i])
                        });
                    }
                }
            } else if (req.body.coldProductCode && req.body.coldQuantity) {
                selfColdDetails.push({
                    productCode: req.body.coldProductCode,
                    quantity: parseInt(req.body.coldQuantity)
                });
            }
        }

        // 将之前的待审核/已通过提交标记为历史
        await Submission.updateMany(
            { cn: cn, group_text: group, status: { $in: ['待审核', '已通过'] } },
            { status: '历史' }
        );

        // 获取上传的图片文件名（GridFS 存储的文件名）
        var pushImages = [];
        var selfColdImages = [];

        if (req.files) {
            if (req.files.pushImages && req.files.pushImages.length > 0) {
                pushImages = req.files.pushImages.map(file => file.filename);
            }
            if (req.files.selfColdImages && req.files.selfColdImages.length > 0) {
                selfColdImages = req.files.selfColdImages.map(file => file.filename);
            }
        }

        // 创建新提交
        const submission = new Submission({
            cn: cn,
            group_text: group,
            pushType: pushType,
            pushDetails: pushDetails,
            selfColdDetails: selfColdDetails,
            pushImages: pushImages,
            selfColdImages: selfColdImages,
            status: '待审核'
        });

        await submission.save();
        res.json({ success: true, message: '提交成功，等待管理员审核' });
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).json({ error: error.message });
    }
});

// 管理员：获取所有分配（保持不变）
app.get('/api/admin/allocations', async function(req, res) {
    try {
        const allocations = await Allocation.find().sort({ createdAt: -1 });
        res.json(allocations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 管理员：创建分配（保持不变）
app.post('/api/admin/allocations', async function(req, res) {
    try {
        var group = req.body.group;
        var productCode = req.body.productCode;
        var allocations = req.body.allocations;

        console.log('收到分配:', group, productCode, allocations);

        const allocation = new Allocation({
            group_text: group,
            productCode: productCode,
            allocations: allocations
        });

        await allocation.save();
        res.json({ success: true, message: '分配提交成功' });
    } catch (error) {
        console.error('Allocation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 管理员：更新分配（保持不变）
app.put('/api/admin/allocations/:id', async function(req, res) {
    try {
        var id = req.params.id;
        var group = req.body.group;
        var productCode = req.body.productCode;
        var allocations = req.body.allocations;

        await Allocation.findByIdAndUpdate(id, {
            group_text: group,
            productCode: productCode,
            allocations: allocations,
            updatedAt: new Date()
        });

        res.json({ success: true, message: '更新成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 管理员：删除分配（保持不变）
app.delete('/api/admin/allocations/:id', async function(req, res) {
    try {
        var id = req.params.id;
        await Allocation.findByIdAndDelete(id);
        res.json({ success: true, message: '删除成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取待审核提交（保持不变）
app.get('/api/admin/pending-submissions', async function(req, res) {
    try {
        const pending = await Submission.find({ status: '待审核' }).sort({ createdAt: -1 });
        res.json(pending);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 审核通过（保持不变）
app.post('/api/admin/approve-submission/:id', async function(req, res) {
    try {
        var id = req.params.id;
        await Submission.findByIdAndUpdate(id, { status: '已通过' });
        res.json({ success: true, message: '审核通过' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 拒绝提交（保持不变）
app.delete('/api/admin/reject-submission/:id', async function(req, res) {
    try {
        var id = req.params.id;
        await Submission.findByIdAndDelete(id);
        res.json({ success: true, message: '已拒绝' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============= 捆率管理 API =============
// 获取所有捆率
app.get('/api/admin/rates', async (req, res) => {
    try {
        const rates = await Rate.find().sort({ productCode: 1 });
        res.json(rates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 添加捆率
app.post('/api/admin/rates', async (req, res) => {
    try {
        const { productCode, rate } = req.body;

        // 验证格式
        if (!/^[A-Za-z]\d+$/.test(productCode)) {
            return res.status(400).json({ error: '商品编号格式应为字母+数字' });
        }

        // 检查是否已存在
        const existing = await Rate.findOne({ productCode: productCode.toUpperCase() });
        if (existing) {
            return res.status(400).json({ error: '该商品已存在' });
        }

        const newRate = new Rate({
            productCode: productCode.toUpperCase(),
            rate: parseInt(rate),
            description: rate === '0' ? '无捆' : `1k${rate}`
        });

        await newRate.save();
        res.json({ success: true, message: '添加成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 更新捆率
app.put('/api/admin/rates/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const { rate } = req.body;

        await Rate.findOneAndUpdate(
            { productCode: code },
            {
                rate: parseInt(rate),
                description: rate === '0' ? '无捆' : `1k${rate}`,
                updatedAt: new Date()
            }
        );

        res.json({ success: true, message: '更新成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 删除捆率
app.delete('/api/admin/rates/:code', async (req, res) => {
    try {
        const { code } = req.params;
        await Rate.deleteOne({ productCode: code });
        res.json({ success: true, message: '删除成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 捆率更新后重新计算
app.post('/api/admin/recalculate-all', async (req, res) => {
    try {
        console.log('捆率已更新，触发重新计算');
        res.json({ success: true, message: '重新计算触发成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============= 获取团员捆表 =============
app.get('/api/admin/bundle-table', async function(req, res) {
    try {
        const allocations = await Allocation.find();
        const submissions = await Submission.find({ status: '已通过' });
        const rates = await Rate.find();

        // 转换为对象方便查找
        const bundleRates = {};
        rates.forEach(r => {
            bundleRates[r.productCode] = r.rate;
        });

        var bundleTable = [];

        for (var i = 0; i < allocations.length; i++) {
            var allocation = allocations[i];

            for (var j = 0; j < allocation.allocations.length; j++) {
                var item = allocation.allocations[j];

                var submission = null;
                for (var k = 0; k < submissions.length; k++) {
                    if (submissions[k].cn === item.cn &&
                        submissions[k].group_text === allocation.group_text) {
                        submission = submissions[k];
                        break;
                    }
                }

                var rate = bundleRates[allocation.productCode] || 0;
                var actualRate = rate;

                if (submission && submission.pushType === '没推' && rate > 0) {
                    actualRate = rate + 1;
                }

                var originalBundles = item.quantity * actualRate;

                var releaseBundles = 0;
                if (submission) {
                    var totalPush = 0;
                    var totalCold = 0;

                    for (var p = 0; p < submission.pushDetails.length; p++) {
                        totalPush += submission.pushDetails[p].quantity;
                    }

                    for (var c = 0; c < submission.selfColdDetails.length; c++) {
                        totalCold += submission.selfColdDetails[c].quantity;
                    }

                    var theoreticalRelease = Math.floor((totalPush + totalCold) / 2);
                    releaseBundles = Math.min(theoreticalRelease, originalBundles);
                }

                var finalBundles = Math.max(0, originalBundles - releaseBundles);

                bundleTable.push({
                    cn: item.cn,
                    group: allocation.group_text,
                    productCode: allocation.productCode,
                    quantity: item.quantity,
                    rate: rate,
                    actualRate: actualRate,
                    originalBundles: originalBundles,
                    pushType: submission ? submission.pushType : '未提交',
                    pushDetails: submission ? submission.pushDetails.map(d => d.productCode + ':' + d.quantity).join(', ') : '无',
                    pushImages: submission && submission.pushImages ? submission.pushImages : [],
                    selfColdDetails: submission ? submission.selfColdDetails.map(d => d.productCode + ':' + d.quantity).join(', ') : '无',
                    selfColdImages: submission && submission.selfColdImages ? submission.selfColdImages : [],
                    releaseBundles: releaseBundles,
                    finalBundles: finalBundles,
                    status: submission ? '已提交' : '待提交',
                    allocationId: allocation._id
                });
            }
        }

        res.json(bundleTable);
    } catch (error) {
        console.error('Bundle table error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= 清空数据库 =============
app.post('/api/admin/clear-database', async function(req, res) {
    try {
        var confirmText = req.body.confirmText;

        if (confirmText !== '我确定清空') {
            return res.status(400).json({ error: '确认文本不正确' });
        }

        // 只清空分配和提交记录，保留捆率规则
        await Allocation.deleteMany({});
        await Submission.deleteMany({});

        res.json({ success: true, message: '捆表数据已清空，捆率规则已保留' });
    } catch (error) {
        console.error('Clear database error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= 启动服务器 =============
var PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
    console.log('Server running on port ' + PORT);
    console.log('访问地址:');
    console.log('- 团员提交页面: http://localhost:' + PORT);
    console.log('- 管理员页面: http://localhost:' + PORT + '/admin.html');
});