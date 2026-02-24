const fs = require('fs');
const path = require('path');

// 获取数据库文件路径
function getDbPath() {
    // 优先使用环境变量指定的路径
    if (process.env.DB_PATH) {
        return process.env.DB_PATH;
    }

    // Render 环境
    if (process.env.RENDER === 'true') {
        const renderPath = '/opt/render/project/src/data/database.json';
        // 确保目录存在
        const dir = path.dirname(renderPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return renderPath;
    }

    // 本地环境
    return path.join(__dirname, 'database.json');
}

const DB_FILE = getDbPath();
console.log('数据库文件路径:', DB_FILE);

// 初始化数据结构
let data = {
    allocations: [],
    submissions: []
};

// 如果文件存在，加载数据
if (fs.existsSync(DB_FILE)) {
    try {
        data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log('数据库加载成功，记录数:', {
            allocations: data.allocations.length,
            submissions: data.submissions.length
        });
    } catch (e) {
        console.log('数据库文件损坏，重新创建');
    }
} else {
    // 文件不存在，创建空数据并保存
    saveData();
}

// 保存数据到文件
function saveData() {
    try {
        // 确保目录存在
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
        console.log('数据已保存到:', DB_FILE);
    } catch (error) {
        console.error('保存数据失败:', error);
    }
}

// ... 其余代码保持不变

// 分配相关操作
const Allocation = {
    getAll: function() {
        return data.allocations.sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );
    },

    create: function(group, productCode, allocations) {
        const newAlloc = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            group_text: group,
            productCode: productCode,
            allocations: allocations,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        data.allocations.push(newAlloc);
        saveData();
        return newAlloc;
    },

    update: function(id, group, productCode, allocations) {
        const index = data.allocations.findIndex(a => a.id === id);
        if (index !== -1) {
            data.allocations[index] = {
                ...data.allocations[index],
                group_text: group,
                productCode: productCode,
                allocations: allocations,
                updatedAt: new Date().toISOString()
            };
            saveData();
            return true;
        }
        return false;
    },

    delete: function(id) {
        const index = data.allocations.findIndex(a => a.id === id);
        if (index !== -1) {
            data.allocations.splice(index, 1);
            saveData();
            return true;
        }
        return false;
    }
};

// 提交相关操作
const Submission = {
    // 获取所有最新提交（兼容旧代码）
    getLatest: function() {
        return data.submissions.filter(s => s.status === '已通过');
    },

    // 获取某个团员的最新提交
    getByUser: function(cn, group) {
        return data.submissions.find(s =>
            s.cn === cn && s.group_text === group && s.status === '已通过'
        );
    },

    // 将旧提交标记为历史
    markHistory: function(cn, group) {
        data.submissions.forEach(s => {
            if (s.cn === cn && s.group_text === group && (s.status === '待审核' || s.status === '已通过')) {
                s.status = '历史';
            }
        });
        saveData();
    },

    // 创建新提交（状态为待审核）
    create: function(submission) {
        const newSub = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            ...submission,
            status: '待审核',
            createdAt: new Date().toISOString()
        };
        data.submissions.push(newSub);
        saveData();
        return newSub;
    },

    // 获取所有提交（用于调试）
    getAll: function() {
        return data.submissions;
    },

    // 获取待审核提交
    getPending: function() {
        return data.submissions.filter(s => s.status === '待审核');
    },

    // 获取已通过的提交
    getApproved: function() {
        return data.submissions.filter(s => s.status === '已通过');
    },

    // 审核通过
    approve: function(id) {
        const index = data.submissions.findIndex(s => s.id === id);
        if (index !== -1) {
            data.submissions[index].status = '已通过';
            saveData();
            return true;
        }
        return false;
    },

    // 拒绝（删除）
    reject: function(id) {
        const index = data.submissions.findIndex(s => s.id === id);
        if (index !== -1) {
            data.submissions.splice(index, 1);
            saveData();
            return true;
        }
        return false;
    }
};

module.exports = {
    Allocation,
    Submission
};