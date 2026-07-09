// Frontend application logic

// State Management
let currentUser = null;
let csrfToken = null;
let currentFolder = '/';
let currentNav = 'all'; // 'all', 'trash'
let activeFolders = [];
let linkPollingInterval = null;
let shareBotUsername = null;

// DOM Elements
const loginContainer = document.getElementById('login-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const dashboardContainer = document.getElementById('dashboard-container');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const linkTgBtn = document.getElementById('link-tg-btn');
const storageFill = document.getElementById('storage-fill');
const storageUsed = document.getElementById('storage-used');
const activeFilesCount = document.getElementById('active-files-count');
const breadcrumbs = document.getElementById('breadcrumbs');
const foldersGrid = document.getElementById('folders-grid');
const filesTbody = document.getElementById('files-tbody');
const noFilesMsg = document.getElementById('no-files-msg');
const currentViewTitle = document.getElementById('current-view-title');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const btnUploadFile = document.getElementById('btn-upload-file');
const btnRefresh = document.getElementById('btn-refresh');
const btnImportUrl = document.getElementById('btn-import-url');
const toastElement = document.getElementById('toast');
const toastText = document.getElementById('toast-text');

// Modals
const modalLinkTg = document.getElementById('modal-link-tg');
const modalImportUrl = document.getElementById('modal-import-url');
const modalFileInfo = document.getElementById('modal-file-info');
const modalEditTags = document.getElementById('modal-edit-tags');
const modalMoveFolder = document.getElementById('modal-move-folder');

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEventListeners();
});

// Helper: Show notifications
function showToast(message, isError = false) {
  toastText.textContent = message;
  if (isError) {
    toastElement.style.borderColor = 'var(--danger)';
  } else {
    toastElement.style.borderColor = 'var(--accent-cyan)';
  }
  toastElement.classList.add('active');
  setTimeout(() => {
    toastElement.classList.remove('active');
  }, 4000);
}

// Check if user is logged in
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.loggedIn) {
      currentUser = data.user;
      csrfToken = data.csrfToken;
      shareBotUsername = data.shareBotUsername;
      showDashboard();
    } else {
      showLogin();
    }
  } catch (error) {
    console.error('Session verification failed:', error);
    showLogin();
  }
}

// UI state toggles
function showLogin() {
  currentUser = null;
  csrfToken = null;
  dashboardContainer.classList.add('hidden');
  loginContainer.classList.add('active');
}

function showDashboard() {
  loginContainer.classList.remove('active');
  dashboardContainer.classList.remove('hidden');
  userDisplay.textContent = currentUser.username;
  
  // Link Telegram status color
  if (currentUser.telegram_chat_id) {
    linkTgBtn.textContent = '✅ Linked to Bot';
    linkTgBtn.classList.remove('pulse-border');
    linkTgBtn.style.borderColor = 'var(--success)';
  } else {
    linkTgBtn.textContent = '🔗 Link Telegram';
    linkTgBtn.classList.add('pulse-border');
    linkTgBtn.style.borderColor = '';
  }

  currentFolder = '/';
  currentNav = 'all';
  updateNavState();
  loadExplorer();
}

// Navigation update
function updateNavState() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.dataset.nav === currentNav) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (currentNav === 'trash') {
    currentViewTitle.textContent = 'Trash folder';
    dropZone.classList.add('hidden');
    foldersGrid.classList.add('hidden');
    document.querySelector('div.section-title:nth-of-type(1)').classList.add('hidden');
  } else {
    currentViewTitle.textContent = currentFolder === '/' ? 'Root directory' : currentFolder;
    dropZone.classList.remove('hidden');
    foldersGrid.classList.remove('hidden');
    document.querySelector('div.section-title:nth-of-type(1)').classList.remove('hidden');
  }
}

// Load Explorer (folders, files, stats)
async function loadExplorer() {
  if (!currentUser) return;
  
  await Promise.all([
    fetchFolders(),
    fetchFiles(),
    fetchStats()
  ]);
  
  renderBreadcrumbs();
}

// Fetch stats
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();
    
    // Total size format
    storageUsed.textContent = formatBytes(stats.totalSize);
    activeFilesCount.textContent = `${stats.totalFiles} active files`;
    
    // Standard size limits: 2GB default for simulation
    const limit = 2 * 1024 * 1024 * 1024;
    const percentage = Math.min(100, Math.round((stats.totalSize / limit) * 100));
    storageFill.style.width = `${percentage}%`;

  } catch (error) {
    console.error('Error fetching statistics:', error);
  }
}

// Fetch Folders
async function fetchFolders() {
  if (currentNav === 'trash') return;
  try {
    const res = await fetch('/api/folders');
    if (!res.ok) return;
    const data = await res.json();
    activeFolders = data.folders;
    renderFolders();
  } catch (error) {
    console.error('Error fetching folders list:', error);
  }
}

// Fetch Files
async function fetchFiles() {
  try {
    let url = `/api/files?trash=${currentNav === 'trash' ? 'true' : 'false'}`;
    if (currentNav !== 'trash') {
      url += `&folder=${encodeURIComponent(currentFolder)}`;
    }
    if (searchInput.value.trim()) {
      url += `&search=${encodeURIComponent(searchInput.value.trim())}`;
    }

    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    renderFiles(data.files);
  } catch (error) {
    console.error('Error fetching files:', error);
  }
}

// Render folder cards
function renderFolders() {
  foldersGrid.replaceChildren();

  // Find subfolders in current directory folder
  const currentDepth = currentFolder === '/' ? 1 : currentFolder.split('/').length;
  
  const subfolders = activeFolders
    .filter(f => {
      if (f === '/') return false;
      if (currentFolder === '/') {
        // Find roots level folders (e.g. /Photos, but not /Photos/Vacation)
        return f.split('/').length === 2 && f.startsWith('/');
      } else {
        // Find children level folders (e.g. /Photos/Vacation when current is /Photos)
        return f.startsWith(currentFolder + '/') && f.split('/').length === currentDepth + 1;
      }
    })
    .map(f => {
      const parts = f.split('/');
      return {
        path: f,
        name: parts[parts.length - 1]
      };
    });

  if (subfolders.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'no-files-msg';
    emptyMsg.textContent = 'No subfolders';
    emptyMsg.style.padding = '20px';
    foldersGrid.appendChild(emptyMsg);
    return;
  }

  subfolders.forEach(sub => {
    const card = document.createElement('div');
    card.className = 'folder-card glass-card';
    card.addEventListener('click', () => {
      currentFolder = sub.path;
      updateNavState();
      loadExplorer();
    });

    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = '📁';

    const info = document.createElement('div');
    info.className = 'folder-info';

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = sub.name;

    info.appendChild(name);
    card.appendChild(icon);
    card.appendChild(info);
    foldersGrid.appendChild(card);
  });
}

// Render files list
function renderFiles(files) {
  filesTbody.replaceChildren();

  if (files.length === 0) {
    noFilesMsg.classList.remove('hidden');
    return;
  }
  noFilesMsg.classList.add('hidden');

  files.forEach(file => {
    const tr = document.createElement('tr');

    // Name column
    const tdName = document.createElement('td');
    const nameCell = document.createElement('div');
    nameCell.className = 'file-name-cell';

    const fileIcon = document.createElement('span');
    fileIcon.className = 'file-icon';
    fileIcon.textContent = getFileEmoji(file.mime_type);

    const nameText = document.createElement('span');
    nameText.className = 'file-name-text clickable';
    nameText.textContent = file.name;
    nameText.addEventListener('click', () => openPreviewModal(file));

    nameCell.appendChild(fileIcon);
    nameCell.appendChild(nameText);
    tdName.appendChild(nameCell);

    // Size column
    const tdSize = document.createElement('td');
    tdSize.textContent = formatBytes(file.size);

    // Source column
    const tdSource = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-${file.source}`;
    badge.textContent = file.source.toUpperCase();
    tdSource.appendChild(badge);

    // Tags column
    const tdTags = document.createElement('td');
    if (file.tags && file.tags.length > 0) {
      file.tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = `#${tag}`;
        tdTags.appendChild(chip);
      });
    } else {
      tdTags.textContent = '-';
    }

    // Date column
    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(file.created_at).toLocaleDateString();

    // Actions column
    const tdActions = document.createElement('td');
    const actionsCell = document.createElement('div');
    actionsCell.className = 'actions-cell';

    if (currentNav === 'trash') {
      // Restore Button
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'glass-btn';
      restoreBtn.textContent = '🔄 Restore';
      restoreBtn.addEventListener('click', () => handleRestore(file.id));

      // Permanent Delete Button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'glass-btn';
      deleteBtn.style.color = 'var(--danger)';
      deleteBtn.textContent = '🗑 Permanently Delete';
      deleteBtn.addEventListener('click', () => handleDelete(file.id, true));

      actionsCell.appendChild(restoreBtn);
      actionsCell.appendChild(deleteBtn);
    } else {
      // Preview
      const previewBtn = document.createElement('button');
      previewBtn.className = 'glass-btn';
      previewBtn.textContent = '👁️';
      previewBtn.title = 'Preview';
      previewBtn.addEventListener('click', () => openPreviewModal(file));

      // Download
      const dlBtn = document.createElement('button');
      dlBtn.className = 'glass-btn';
      dlBtn.textContent = '📥';
      dlBtn.title = 'Download';
      dlBtn.addEventListener('click', () => {
        window.location.href = `/api/files/download/${file.id}`;
      });

      // Info
      const infoBtn = document.createElement('button');
      infoBtn.className = 'glass-btn';
      infoBtn.textContent = 'ℹ️';
      infoBtn.title = 'Metadata';
      infoBtn.addEventListener('click', () => openInfoModal(file));

      // Tags
      const tagsBtn = document.createElement('button');
      tagsBtn.className = 'glass-btn';
      tagsBtn.textContent = '🏷';
      tagsBtn.title = 'Edit Tags';
      tagsBtn.addEventListener('click', () => openTagsModal(file));

      // Move
      const moveBtn = document.createElement('button');
      moveBtn.className = 'glass-btn';
      moveBtn.textContent = '📁';
      moveBtn.title = 'Move';
      moveBtn.addEventListener('click', () => openMoveModal(file));

      // Trash
      const trashBtn = document.createElement('button');
      trashBtn.className = 'glass-btn';
      trashBtn.textContent = '🗑';
      trashBtn.title = 'Trash';
      trashBtn.style.color = 'var(--danger)';
      trashBtn.addEventListener('click', () => handleDelete(file.id, false));

      actionsCell.appendChild(previewBtn);
      actionsCell.appendChild(dlBtn);
      actionsCell.appendChild(infoBtn);
      actionsCell.appendChild(tagsBtn);
      actionsCell.appendChild(moveBtn);
      actionsCell.appendChild(trashBtn);
    }

    tdActions.appendChild(actionsCell);

    tr.appendChild(tdName);
    tr.appendChild(tdSize);
    tr.appendChild(tdSource);
    tr.appendChild(tdTags);
    tr.appendChild(tdDate);
    tr.appendChild(tdActions);

    filesTbody.appendChild(tr);
  });
}

// Render Breadcrumbs
function renderBreadcrumbs() {
  breadcrumbs.replaceChildren();

  const rootCrumb = document.createElement('span');
  rootCrumb.className = currentFolder === '/' ? 'crumb active' : 'crumb';
  rootCrumb.textContent = 'Root';
  rootCrumb.addEventListener('click', () => {
    if (currentFolder !== '/') {
      currentFolder = '/';
      updateNavState();
      loadExplorer();
    }
  });
  breadcrumbs.appendChild(rootCrumb);

  if (currentFolder === '/') return;

  const parts = currentFolder.split('/').filter(p => p.length > 0);
  let resolvedPath = '';

  parts.forEach((part, index) => {
    resolvedPath += '/' + part;

    const separator = document.createElement('span');
    separator.className = 'crumb-separator';
    separator.textContent = ' > ';
    breadcrumbs.appendChild(separator);

    const crumb = document.createElement('span');
    crumb.className = index === parts.length - 1 ? 'crumb active' : 'crumb';
    crumb.textContent = part;
    
    const targetPath = resolvedPath;
    crumb.addEventListener('click', () => {
      if (currentFolder !== targetPath) {
        currentFolder = targetPath;
        updateNavState();
        loadExplorer();
      }
    });

    breadcrumbs.appendChild(crumb);
  });
}

// Helper: Format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper: Mime Emojis
function getFileEmoji(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '📷';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) return '📦';
  return '📄';
}

// Operations handlers
async function handleDelete(fileId, permanent) {
  const confirmMsg = permanent 
    ? 'Are you sure you want to permanently delete this file? This action is irreversible.'
    : 'Move this file to trash?';
    
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/files/${fileId}?permanent=${permanent}`, {
      method: 'DELETE',
      headers: {
        'x-csrf-token': csrfToken
      }
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Deleted successfully');
      loadExplorer();
    } else {
      showToast(data.error || 'Failed to delete file', true);
    }
  } catch (error) {
    showToast('Failed to delete file due to network error', true);
  }
}

async function handleRestore(fileId) {
  try {
    const res = await fetch(`/api/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ is_trashed: false })
    });

    if (res.ok) {
      showToast('File restored successfully');
      loadExplorer();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to restore file', true);
    }
  } catch (error) {
    showToast('Network error restoring file', true);
  }
}

// Modal open tools
const modalPreview = document.getElementById('modal-preview');
const previewTitle = document.getElementById('preview-title');
const previewBody = document.getElementById('preview-body');
const previewDownloadBtn = document.getElementById('preview-download-btn');

function openPreviewModal(file) {
  previewTitle.textContent = file.name;
  previewDownloadBtn.href = `/api/files/download/${file.id}`;
  
  previewBody.replaceChildren();
  
  const mimeType = file.mime_type || '';
  const url = `/api/files/download/${file.id}`;
  
  if (mimeType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = file.name;
    previewBody.appendChild(img);
  } else if (mimeType.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    previewBody.appendChild(video);
  } else if (mimeType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.controls = true;
    audio.autoplay = true;
    previewBody.appendChild(audio);
  } else {
    const container = document.createElement('div');
    container.className = 'preview-unsupported';
    
    const icon = document.createElement('span');
    icon.style.fontSize = '3rem';
    icon.textContent = getFileEmoji(mimeType);
    
    const text = document.createElement('span');
    text.textContent = 'Preview not supported for this file type.';
    
    container.appendChild(icon);
    container.appendChild(text);
    previewBody.appendChild(container);
  }
  
  modalPreview.classList.add('active');
}

function openInfoModal(file) {
  document.getElementById('info-name').textContent = file.name;
  document.getElementById('info-size').textContent = formatBytes(file.size);
  document.getElementById('info-folder').textContent = file.folder;
  document.getElementById('info-date').textContent = new Date(file.created_at).toLocaleString();
  document.getElementById('info-sha').textContent = file.sha256;
  document.getElementById('info-tg-id').textContent = file.telegram_file_id;

  let sourceStr = 'Web Upload';
  if (file.source === 'telegram') sourceStr = 'Telegram Bot';
  else if (file.source === 'api') sourceStr = 'API';
  else if (file.source === 'import') sourceStr = 'URL Import';
  document.getElementById('info-source').textContent = sourceStr;

  const tagsDiv = document.getElementById('info-tags');
  tagsDiv.replaceChildren();
  if (file.tags && file.tags.length > 0) {
    file.tags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = `#${tag}`;
      tagsDiv.appendChild(chip);
    });
  } else {
    tagsDiv.textContent = 'None';
  }

  // Handle Share Link populate & copy logic
  const shareLinkAnchor = document.getElementById('info-share-link');
  const copyBtn = document.getElementById('btn-copy-share');
  
  if (shareBotUsername) {
    const shareUrl = `https://t.me/${shareBotUsername}?start=${file.id}`;
    shareLinkAnchor.href = shareUrl;
    shareLinkAnchor.textContent = shareUrl;
    shareLinkAnchor.style.display = 'inline';
    copyBtn.style.display = 'inline-block';
    
    // Refresh button and event listener
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
    newCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(shareUrl)
        .then(() => {
          showToast('Share link copied to clipboard!');
        })
        .catch(err => {
          console.error('Failed to copy: ', err);
          showToast('Failed to copy link', true);
        });
    });
  } else {
    shareLinkAnchor.removeAttribute('href');
    shareLinkAnchor.textContent = 'Share bot not configured';
    copyBtn.style.display = 'none';
  }

  modalFileInfo.classList.add('active');
}

function openTagsModal(file) {
  document.getElementById('edit-tags-file-id').value = file.id;
  document.getElementById('tags-input').value = file.tags ? file.tags.join(', ') : '';
  modalEditTags.classList.add('active');
}

function openMoveModal(file) {
  document.getElementById('move-folder-file-id').value = file.id;
  document.getElementById('move-folder-input').value = file.folder;
  modalMoveFolder.classList.add('active');
}

// Event Listeners setup
function setupEventListeners() {
  // Login submission
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });

      const data = await res.json();
      if (res.ok) {
        currentUser = data.user;
        shareBotUsername = data.shareBotUsername;
        // Read csrf from cookie or auth response
        const match = document.cookie.match(/(?:^|; )csrf-token=([^;]*)/);
        csrfToken = match ? match[1] : null;
        showDashboard();
      } else {
        loginError.textContent = data.error || 'Authentication failed.';
      }
    } catch (error) {
      loginError.textContent = 'Network error occurred.';
    }
  });

  // Logout click
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken }
      });
      showLogin();
    } catch (e) {
      showLogin();
    }
  });

  // Sidebar navigation click
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      currentNav = btn.dataset.nav;
      updateNavState();
      loadExplorer();
    });
  });

  // Live search input
  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    if (searchInput.value.trim()) {
      searchClearBtn.classList.remove('hidden');
    } else {
      searchClearBtn.classList.add('hidden');
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadExplorer();
    }, 4000); // 400ms debounce
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    loadExplorer();
  });

  // Close modals
  document.querySelectorAll('.modal .close-btn, .modal .cancel-btn, .modal .close-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
      // Stop any media playback
      document.getElementById('preview-body').replaceChildren();
      if (linkPollingInterval) {
        clearInterval(linkPollingInterval);
        linkPollingInterval = null;
      }
    });
  });

  // Link Telegram click wizard
  linkTgBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/link-token', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken }
      });
      
      if (!res.ok) {
        showToast('Failed to generate connection link', true);
        return;
      }
      
      const data = await res.json();
      
      // Update link details in Modal
      const linkCta = document.getElementById('tg-direct-link');
      linkCta.href = data.linkUrl;

      const statusText = document.getElementById('tg-status-text');
      if (currentUser.telegram_chat_id) {
        statusText.textContent = 'Connected';
        statusText.className = 'badge status-connected';
      } else {
        statusText.textContent = 'Awaiting Bot Start...';
        statusText.className = 'badge status-pending';
      }

      modalLinkTg.classList.add('active');

      // Start polling for linking updates
      if (!currentUser.telegram_chat_id) {
        linkPollingInterval = setInterval(async () => {
          const verifyRes = await fetch('/api/auth/me');
          const verifyData = await verifyRes.json();
          if (verifyData.loggedIn && verifyData.user.telegram_chat_id) {
            currentUser = verifyData.user;
            statusText.textContent = 'Connected';
            statusText.className = 'badge status-connected';
            showToast('Telegram Bot linked successfully!');
            
            // Re-render dashboard header linking status
            linkTgBtn.textContent = '✅ Linked to Bot';
            linkTgBtn.classList.remove('pulse-border');
            linkTgBtn.style.borderColor = 'var(--success)';
            
            clearInterval(linkPollingInterval);
            linkPollingInterval = null;
            
            setTimeout(() => {
              modalLinkTg.classList.remove('active');
            }, 1500);
          }
        }, 5000);
      }

    } catch (error) {
      showToast('Error initializing linking wizard', true);
    }
  });

  // Refresh files list manual trigger
  btnRefresh.addEventListener('click', () => {
    btnRefresh.textContent = '🔄 Loading...';
    btnRefresh.disabled = true;
    loadExplorer().finally(() => {
      btnRefresh.textContent = '🔄 Refresh';
      btnRefresh.disabled = false;
    });
  });

  // Import URL submissions
  btnImportUrl.addEventListener('click', () => {
    document.getElementById('import-error').textContent = '';
    document.getElementById('import-url-input').value = '';
    document.getElementById('import-folder-input').value = currentFolder === '/' ? '' : currentFolder;
    modalImportUrl.classList.add('active');
  });

  document.getElementById('import-url-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('import-error');
    const submitBtn = document.getElementById('import-submit-btn');
    errorBox.textContent = '';

    const urlValue = document.getElementById('import-url-input').value;
    const folderValue = document.getElementById('import-folder-input').value || '/';

    submitBtn.textContent = 'Downloading...';
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/files/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ url: urlValue, folder: folderValue })
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Imported successfully: ${data.name}`);
        modalImportUrl.classList.remove('active');
        loadExplorer();
      } else {
        errorBox.textContent = data.error || 'Failed to import link.';
      }
    } catch (err) {
      errorBox.textContent = 'Import failed due to server error.';
    } finally {
      submitBtn.textContent = 'Start Import';
      submitBtn.disabled = false;
    }
  });

  // Save tags form
  document.getElementById('edit-tags-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileId = document.getElementById('edit-tags-file-id').value;
    const tagsString = document.getElementById('tags-input').value;
    
    // Parse tags array
    const tagsArray = tagsString.split(/[\s,]+/).filter(t => t.trim().length > 0);

    try {
      const res = await fetch(`/api/files/${fileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ tags: tagsArray })
      });

      if (res.ok) {
        showToast('Tags updated');
        modalEditTags.classList.remove('active');
        loadExplorer();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to update tags', true);
      }
    } catch (err) {
      showToast('Server error updating tags', true);
    }
  });

  // Move folder form
  document.getElementById('move-folder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileId = document.getElementById('move-folder-file-id').value;
    const folderPath = document.getElementById('move-folder-input').value;

    try {
      const res = await fetch(`/api/files/${fileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ folder: folderPath })
      });

      if (res.ok) {
        showToast('File moved successfully');
        modalMoveFolder.classList.remove('active');
        loadExplorer();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to move file', true);
      }
    } catch (err) {
      showToast('Server error moving file', true);
    }
  });

  // Drag and Drop uploads handlers
  btnUploadFile.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFilesUpload(fileInput.files);
    }
  });

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  ['dragleave', 'dragend'].forEach(evt => {
    dropZone.addEventListener(evt, () => {
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  });
}

// Upload file implementation
async function handleFilesUpload(filesList) {
  if (!currentUser.telegram_chat_id) {
    showToast('Please link your Telegram Bot first in settings.', true);
    return;
  }

  const dropZoneText = dropZone.querySelector('.drop-zone-text span:first-child');
  const originalText = dropZoneText.textContent;
  
  for (let i = 0; i < filesList.length; i++) {
    const file = filesList[i];
    
    // Safety check file size: 100MB
    if (file.size > 100 * 1024 * 1024) {
      showToast(`File ${file.name} exceeds 100MB upload limit.`, true);
      continue;
    }

    dropZoneText.textContent = `Uploading ${file.name}... (${i + 1}/${filesList.length})`;
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', currentFolder);

    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken
        },
        body: formData
      });

      if (res.ok) {
        showToast(`Uploaded successfully: ${file.name}`);
      } else {
        const data = await res.json();
        showToast(`Upload failed for ${file.name}: ${data.error || 'Server error'}`, true);
      }
    } catch (error) {
      showToast(`Upload failed for ${file.name} due to network issue.`, true);
    }
  }

  dropZoneText.textContent = originalText;
  fileInput.value = ''; // clear input
  loadExplorer();
}
