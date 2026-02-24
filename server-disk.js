const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// 引入文件数据库
const { Allocation, Submission } = require('./db');

const app = express();

// 中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 创建上传目录
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置文件上传（修改为支持多图）
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
    limits: { fileSize: 5 * 1024 * 1024 } // 单个文件限制5MB
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

        // 确保 allocations 是数组
        var allocList = alloc.allocations;
        if (!Array.isArray(allocList)) {
            console.log('警告: allocations 不是数组', allocList);
            continue;
        }

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

// 修改团员提交接口，支持多图
app.post('/api/submit', upload.fields([
    { name: 'pushImages', maxCount: 10 },      // 推车图最多10张
    { name: 'selfColdImages', maxCount: 10 }    // 自带冷图最多10张
]), function(req, res) {
    try {
        var cn = req.body.cn;
        var group = req.body.group;
        var pushType = req.body.pushType;

        // 解析推车明细
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

        // 解析自带冷明细
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
        Submission.markHistory(cn, group);

        // 获取上传的多张图片
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

        // 创建新提交（状态为待审核）
        Submission.create({
            cn: cn,
            group_text: group,
            pushType: pushType,
            pushDetails: pushDetails,
            selfColdDetails: selfColdDetails,
            pushImages: pushImages,        // 改为数组
            selfColdImages: selfColdImages  // 改为数组
        });

        res.json({ success: true, message: '提交成功，等待管理员审核' });
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).json({ error: error.message });
    }
});

// 管理员：获取所有分配
app.get('/api/admin/allocations', function(req, res) {
    try {
        var allocations = Allocation.getAll();
        res.json(allocations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 管理员：创建分配
app.post('/api/admin/allocations', function(req, res) {
    try {
        var group = req.body.group;
        var productCode = req.body.productCode;
        var allocations = req.body.allocations;

        console.log('收到分配:', group, productCode, allocations);

        Allocation.create(group, productCode, allocations);
        res.json({ success: true, message: '分配提交成功' });
    } catch (error) {
        console.error('Allocation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 管理员：更新分配
app.put('/api/admin/allocations/:id', function(req, res) {
    try {
        var id = req.params.id;
        var group = req.body.group;
        var productCode = req.body.productCode;
        var allocations = req.body.allocations;

        var success = Allocation.update(id, group, productCode, allocations);

        if (success) {
            res.json({ success: true, message: '更新成功' });
        } else {
            res.status(404).json({ error: '记录不存在' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 管理员：删除分配
app.delete('/api/admin/allocations/:id', function(req, res) {
    try {
        var id = req.params.id;

        var success = Allocation.delete(id);

        if (success) {
            res.json({ success: true, message: '删除成功' });
        } else {
            res.status(404).json({ error: '记录不存在' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取总表数据
app.get('/api/admin/summary', function(req, res) {
    try {
        var submissions = Submission.getLatest();
        var allocations = Allocation.getAll();

        console.log('总表计算:');
        console.log('最新提交数:', submissions.length);
        console.log('分配记录数:', allocations.length);

        var summary = [];

        for (var j = 0; j < submissions.length; j++) {
            var submission = submissions[j];
            var result = calculateFinalBundles(submission, allocations);

            var allocationText = '';
            for (var k = 0; k < result.allocations.length; k++) {
                if (k > 0) allocationText += ', ';
                allocationText += result.allocations[k].productCode + ':' + result.allocations[k].quantity;
            }
            if (allocationText === '') allocationText = '无分配';

            var pushText = '';
            for (var k = 0; k < submission.pushDetails.length; k++) {
                if (k > 0) pushText += ', ';
                pushText += submission.pushDetails[k].productCode + ':' + submission.pushDetails[k].quantity;
            }
            if (pushText === '') pushText = '无';

            var coldText = '';
            for (var k = 0; k < submission.selfColdDetails.length; k++) {
                if (k > 0) coldText += ', ';
                coldText += submission.selfColdDetails[k].productCode + ':' + submission.selfColdDetails[k].quantity;
            }
            if (coldText === '') coldText = '无';

            summary.push({
                cn: submission.cn,
                group: submission.group_text,
                allocations: allocationText,
                originalBundles: result.totalOriginal,
                pushType: submission.pushType,
                pushDetails: pushText,
                pushImage: submission.pushImage ? '/uploads/' + submission.pushImage : null,
                selfColdDetails: coldText,
                selfColdImage: submission.selfColdImage ? '/uploads/' + submission.selfColdImage : null,
                releaseBundles: result.totalRelease,
                finalBundles: result.finalBundles
            });
        }

        console.log('总表返回数据:', JSON.stringify(summary));
        res.json(summary);
    } catch (error) {
        console.error('Summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 修改 bundle-table 中的图片显示
app.get('/api/admin/bundle-table', function(req, res) {
    try {
        var allocations = Allocation.getAll();
        var submissions = Submission.getApproved();

        console.log('捆表计算:');
        console.log('分配记录数:', allocations.length);
        console.log('最新提交数:', submissions.length);

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
                    pushImages: submission && submission.pushImages ? submission.pushImages : [],  // 改为数组
                    selfColdDetails: submission ? submission.selfColdDetails.map(d => d.productCode + ':' + d.quantity).join(', ') : '无',
                    selfColdImages: submission && submission.selfColdImages ? submission.selfColdImages : [],  // 改为数组
                    releaseBundles: releaseBundles,
                    finalBundles: finalBundles,
                    status: submission ? '已提交' : '待提交',
                    allocationId: allocation.id
                });
            }
        }

        console.log('捆表返回条数:', bundleTable.length);
        res.json(bundleTable);
    } catch (error) {
        console.error('Bundle table error:', error);
        res.status(500).json({ error: error.message });
    }
});
// 获取待审核提交
app.get('/api/admin/pending-submissions', function(req, res) {
    try {
        var pending = Submission.getPending();
        res.json(pending);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 审核通过
app.post('/api/admin/approve-submission/:id', function(req, res) {
    try {
        var id = req.params.id;
        var success = Submission.approve(id);
        if (success) {
            res.json({ success: true, message: '审核通过' });
        } else {
            res.status(404).json({ error: '记录不存在' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 拒绝提交
app.delete('/api/admin/reject-submission/:id', function(req, res) {
    try {
        var id = req.params.id;
        var success = Submission.reject(id);
        if (success) {
            res.json({ success: true, message: '已拒绝' });
        } else {
            res.status(404).json({ error: '记录不存在' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 清空数据库（测试用）
app.post('/api/admin/clear-database', function(req, res) {
    try {
        var confirmText = req.body.confirmText;

        // 验证确认文本
        if (confirmText !== '我确定清空') {
            return res.status(400).json({ error: '确认文本不正确' });
        }

        // 清空数据
        const { Allocation, Submission } = require('./db');

        // 直接操作数据库文件
        const fs = require('fs');
        const path = require('path');
        const DB_FILE = path.join(__dirname, 'database.json');

        // 创建空数据
        const emptyData = {
            allocations: [],
            submissions: []
        };

        // 写入文件
        fs.writeFileSync(DB_FILE, JSON.stringify(emptyData, null, 2));

        // 重新加载 db 模块（可选，但建议重启服务）
        console.log('数据库已清空');

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