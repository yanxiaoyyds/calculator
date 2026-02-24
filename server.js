require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// 连接 MongoDB
// 修改这行
const MONGODB_URI = process.env.MONGODB_URI;

// 添加连接选项
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000, // 5秒超时
    socketTimeoutMS: 45000, // 45秒
}).then(() => {
    console.log('MongoDB connected successfully');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// 定义 Schema
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
    pushImages: [String],
    selfColdImages: [String],
    status: { type: String, default: '待审核' },
    createdAt: { type: Date, default: Date.now }
});

const Allocation = mongoose.model('Allocation', allocationSchema);
const Submission = mongoose.model('Submission', submissionSchema);

// 中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 创建上传目录
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// 捆率映射
const bundleRates = {
    'A1': 2, 'C2': 2, 'C4': 2, 'C8': 2, 'B15': 2,
    'A4': 1, 'B5': 1, 'A10': 1, 'C12': 1, 'B16': 1, 'C14': 1, 'C7': 1
};

// 计算最终捆数函数
function calculateFinalBundles(member, allocations) {
    console.log('\n=== 开始计算 ' + member.cn + ' 的最终捆数 ===');
    console.log('团员提交组别:', member.group);
    console.log('推车类型:', member.pushType);
    console.log('推车明细:', JSON.stringify(member.pushDetails));
    console.log('自带冷明细:', JSON.stringify(member.selfColdDetails));

    var memberAllocations = [];
    for (var i = 0; i < allocations.length; i++) {
        var alloc = allocations[i];
        var allocList = alloc.allocations;

        for (var j = 0; j < allocList.length; j++) {
            if (allocList[j].cn === member.cn &&
                alloc.group_text === member.group) {
                memberAllocations.push({
                    productCode: alloc.productCode,
                    quantity: allocList[j].quantity,
                    group: alloc.group_text
                });
            }
        }
    }

    console.log('当前组别的分配:', JSON.stringify(memberAllocations));

    if (memberAllocations.length === 0) {
        console.log('该团员在当前组别没有分配捆数');
        return {
            allocations: [],
            totalOriginal: 0,
            totalRelease: 0,
            finalBundles: 0
        };
    }

    var totalOriginal = 0;
    memberAllocations.forEach(function(item) {
        var rate = bundleRates[item.productCode] || 0;
        var actualRate = rate;
        if (member.pushType === '没推' && rate > 0) {
            actualRate = rate + 1;
        }
        var needBundles = item.quantity * actualRate;
        totalOriginal += needBundles;
        console.log(item.productCode + ': 分配' + item.quantity + '张，基础捆率' + rate + '，实际捆率' + actualRate + '，需捆' + needBundles + '张');
    });

    var totalPush = 0;
    var totalCold = 0;

    for (var i = 0; i < member.pushDetails.length; i++) {
        totalPush += member.pushDetails[i].quantity;
    }

    for (var i = 0; i < member.selfColdDetails.length; i++) {
        totalCold += member.selfColdDetails[i].quantity;
    }

    console.log('\n解捆计算:');
    console.log('总推车张数:', totalPush);
    console.log('总自带冷张数:', totalCold);

    var theoreticalRelease = Math.floor((totalPush + totalCold) / 2);
    console.log('理论可解捆数: floor((' + totalPush + ' + ' + totalCold + ') / 2) =', theoreticalRelease);

    var totalRelease = Math.min(theoreticalRelease, totalOriginal);
    console.log('实际解捆数(不能超过原捆):', totalRelease);

    var finalBundles = Math.max(0, totalOriginal - totalRelease);

    console.log('\n最终结果: 原捆=' + totalOriginal + ', 解捆=' + totalRelease + ', 后捆=' + finalBundles);
    console.log('=== 计算完成 ===\n');

    return {
        allocations: memberAllocations,
        totalOriginal: totalOriginal,
        totalRelease: totalRelease,
        finalBundles: finalBundles
    };
}

// ============= API路由 =============

// 团员提交
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

// 管理员：获取所有分配
app.get('/api/admin/allocations', async function(req, res) {
    try {
        const allocations = await Allocation.find().sort({ createdAt: -1 });
        res.json(allocations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 管理员：创建分配
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

// 管理员：更新分配
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

// 管理员：删除分配
app.delete('/api/admin/allocations/:id', async function(req, res) {
    try {
        var id = req.params.id;
        await Allocation.findByIdAndDelete(id);
        res.json({ success: true, message: '删除成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取待审核提交
app.get('/api/admin/pending-submissions', async function(req, res) {
    try {
        const pending = await Submission.find({ status: '待审核' }).sort({ createdAt: -1 });
        res.json(pending);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 审核通过
app.post('/api/admin/approve-submission/:id', async function(req, res) {
    try {
        var id = req.params.id;
        await Submission.findByIdAndUpdate(id, { status: '已通过' });
        res.json({ success: true, message: '审核通过' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 拒绝提交
app.delete('/api/admin/reject-submission/:id', async function(req, res) {
    try {
        var id = req.params.id;
        await Submission.findByIdAndDelete(id);
        res.json({ success: true, message: '已拒绝' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取团员捆表
app.get('/api/admin/bundle-table', async function(req, res) {
    try {
        const allocations = await Allocation.find();
        const submissions = await Submission.find({ status: '已通过' });

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

// 清空数据库（测试用）
app.post('/api/admin/clear-database', async function(req, res) {
    try {
        var confirmText = req.body.confirmText;

        if (confirmText !== '我确定清空') {
            return res.status(400).json({ error: '确认文本不正确' });
        }

        await Allocation.deleteMany({});
        await Submission.deleteMany({});

        res.json({ success: true, message: '数据库已清空' });
    } catch (error) {
        console.error('Clear database error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 启动服务器
var PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
    console.log('Server running on port ' + PORT);
    console.log('访问地址:');
    console.log('- 团员提交页面: http://localhost:' + PORT);
    console.log('- 管理员页面: http://localhost:' + PORT + '/admin.html');
});