const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const app = express();
const PORT = 3000;

// Configuração de segurança e sessões
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'mini-dropbox-super-secret-key', // Podes alterar para uma palavra-passe aleatória
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Sessão dura 24 horas
}));

// Palavra-passe de acesso ao teu Dropbox (Podes alterar aqui!)
const ADMIN_PASSWORD = '123'; 

const uploadFolder = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folderName = req.body.folder || '';
        const targetDir = path.join(uploadFolder, folderName);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        cb(null, targetDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ storage });

// ==========================================
// ROTA DE AUTENTICAÇÃO
// ==========================================
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Palavra-passe incorreta.' });
});

app.get('/api/check-auth', (req, res) => {
    if (req.session.authenticated) {
        return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    return res.json({ success: true });
});

// ==========================================
// MIDDLEWARE DE PROTEÇÃO (EXIGE LOGIN)
// ==========================================
const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) {
        return next();
    }
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
};

// ==========================================
// ROTAS ESTÁTICAS E DA API (PROTEGIDAS)
// ==========================================
// Os ficheiros e o painel só podem ser vistos se estiver autenticado
app.use('/files', requireAuth, express.static(uploadFolder));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/upload', requireAuth, upload.array('meuArquivo'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum ficheiro foi enviado.' });
    }
    return res.json({ message: 'Ficheiros enviados com sucesso!', files: req.files });
});

app.get('/api/files', requireAuth, (req, res) => {
    const currentFolder = req.query.folder || '';
    const targetDir = path.join(uploadFolder, currentFolder);

    if (!fs.existsSync(targetDir)) {
        return res.json({ folders: [], files: [] });
    }

    try {
        const items = fs.readdirSync(targetDir);
        const folders = [];
        const files = [];

        items.forEach(item => {
            const itemPath = path.join(targetDir, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                folders.push(item);
            } else {
                files.push({
                    name: item,
                    path: currentFolder ? path.join(currentFolder, item) : item,
                    size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                    url: `http://localhost:${PORT}/files/${currentFolder ? currentFolder + '/' : ''}${item}`
                });
            }
        });

        return res.json({ folders, files });
    } catch (error) {
        console.error('Erro ao ler diretório:', error);
        return res.status(500).json({ error: 'Erro interno ao ler os ficheiros.' });
    }
});

app.delete('/api/files', requireAuth, (req, res) => {
    const { path: filePathRelative } = req.body;
    
    if (!filePathRelative) {
        return res.status(400).json({ error: 'Caminho do ficheiro não fornecido.' });
    }

    const filePath = path.join(uploadFolder, filePathRelative);

    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(filePath);
        }
        return res.json({ message: 'Apagado com sucesso!' });
    } else {
        return res.status(404).json({ error: 'Ficheiro não encontrado.' });
    }
});

app.get('/api/storage', requireAuth, (req, res) => {
    try {
        const getFolderSize = (dirPath) => {
            let totalSize = 0;
            const items = fs.readdirSync(dirPath);
            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);
                if (stats.isDirectory()) {
                    totalSize += getFolderSize(itemPath);
                } else {
                    totalSize += stats.size;
                }
            });
            return totalSize;
        };

        const usedBytes = fs.existsSync(uploadFolder) ? getFolderSize(uploadFolder) : 0;
        const diskSpace = fs.statfsSync(uploadFolder);
        const freeBytes = diskSpace.bavail * diskSpace.bsize;
        const totalDiskBytes = diskSpace.blocks * diskSpace.bsize;

        const formatSize = (bytes) => {
            if (bytes >= 1024 * 1024 * 1024) {
                return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            }
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        };

        const usedDiskBytes = totalDiskBytes - freeBytes;
        const usagePercent = Math.round((usedDiskBytes / totalDiskBytes) * 100);

        res.json({
            usedUploads: formatSize(usedBytes),
            freeDisk: formatSize(freeBytes),
            totalDisk: formatSize(totalDiskBytes),
            usagePercent: usagePercent
        });
    } catch (error) {
        console.error('Erro ao calcular espaço em disco:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas de armazenamento.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Mini Dropbox Cloud rodando em http://localhost:${PORT}`);
});