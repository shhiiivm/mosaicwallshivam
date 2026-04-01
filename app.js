/**
 * Mosaic Wall - App Logic
 * Handles 1920x1080 scaling, grid generation, and Cloudinary polling.
 */

class MosaicWall {
    constructor() {
        this.canvas = document.getElementById('mosaic-canvas');
        this.gridLayer = document.getElementById('grid-layer');
        this.bgLayer = document.getElementById('bg-layer');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.indicator = document.getElementById('status-indicator');

        // Initial state
        this.config = {
            canvasWidth: 1920,
            canvasHeight: 1080,
            gridDensity: 200,
            gridOpacity: 0.5,
            cloudName: '',
            apiKey: '',
            apiSecret: '',
            folderPath: '',
            pollInterval: 7
        };

        this.isZenMode = false;
        this.isPolling = false;
        this.pollTimer = null;
        this.processedImages = new Set(); // Store resource IDs to avoid duplicates
        this.allImageUrls = []; // Track URLs for the "Fill" feature (9 key)
        this.pendingQueue = []; // Queue for sequential Hero Entrances
        this.isAnimatingHero = false; // Prevents overlapping animations
        this.gridCells = []; // DOM elements for the grid

        this.init();
    }

    init() {
        this.loadSettings();
        this.setupEventListeners();
        this.handleResize();
        this.generateGrid();

        // Initial scaling
        window.addEventListener('resize', () => this.handleResize());
    }

    /* --- Configuration & Data Persistence --- */

    loadSettings() {
        const saved = localStorage.getItem('mosaic_config');
        if (saved) {
            try {
                this.config = JSON.parse(saved);
                // Update UI based on loaded config
                document.getElementById('canvas-width').value = this.config.canvasWidth || 1920;
                document.getElementById('canvas-height').value = this.config.canvasHeight || 1080;
                document.getElementById('grid-density').value = this.config.gridDensity;
                document.getElementById('grid-opacity').value = this.config.gridOpacity * 100;
                document.getElementById('opacity-val').textContent = `${this.config.gridOpacity * 100}%`;
                document.getElementById('cloud-name').value = this.config.cloudName;
                document.getElementById('api-key').value = this.config.apiKey;
                document.getElementById('api-secret').value = this.config.apiSecret;
                document.getElementById('folder-path').value = this.config.folderPath;
                document.getElementById('poll-interval').value = this.config.pollInterval;

                this.updateCanvasSize();
                this.updateGridVisuals();
            } catch (e) {
                console.error("Failed to load settings:", e);
            }
        }
    }

    saveSettings() {
        this.config.canvasWidth = parseInt(document.getElementById('canvas-width').value) || 1920;
        this.config.canvasHeight = parseInt(document.getElementById('canvas-height').value) || 1080;
        this.config.gridDensity = parseInt(document.getElementById('grid-density').value);
        this.config.gridOpacity = parseInt(document.getElementById('grid-opacity').value) / 100;
        this.config.cloudName = document.getElementById('cloud-name').value.trim();
        this.config.apiKey = document.getElementById('api-key').value.trim();
        this.config.apiSecret = document.getElementById('api-secret').value.trim();
        this.config.folderPath = document.getElementById('folder-path').value.trim();
        this.config.pollInterval = parseInt(document.getElementById('poll-interval').value);

        localStorage.setItem('mosaic_config', JSON.stringify(this.config));

        this.updateCanvasSize();
        // Restart polling if settings changed
        if (this.isPolling) this.stopPolling();
        if (this.config.cloudName) this.startPolling();

        this.generateGrid();
        this.closeSettings();
    }

    /* --- UI & View State --- */

    setupEventListeners() {
        // Open/Close Settings
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        document.getElementById('close-settings').addEventListener('click', () => this.closeSettings());
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());

        // Opacity Live Slider
        document.getElementById('grid-opacity').addEventListener('input', (e) => {
            const val = e.target.value;
            document.getElementById('opacity-val').textContent = `${val}%`;
            this.config.gridOpacity = val / 100;
            this.updateGridVisuals();
        });

        // Background Upload
        document.getElementById('bg-upload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    this.bgLayer.style.backgroundImage = `url(${event.target.result})`;
                };
                reader.readAsDataURL(file);
            }
        });

        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'f') {
                this.toggleZenMode();
            }
            if (e.key === '9') {
                this.fillRemainingSlots(true); // true = allow duplicates to fill everything
            }
            if (e.key === '8') {
                this.fillRemainingSlots(false); // false = only one of each unique image
            }
            if (e.key.toLowerCase() === 'a') {
                this.adjustOpacity(-0.05);
            }
            if (e.key.toLowerCase() === 'b') {
                this.adjustOpacity(0.05);
            }
            if (e.key.toLowerCase() === 'r') {
                this.resetWall();
            }
            if (e.key === 'Escape' && !this.settingsModal.classList.contains('hidden')) {
                this.closeSettings();
            }
        });
    }

    resetWall() {
        console.log("Resetting Mosaic Wall...");

        // Stop current animation/polling
        this.stopPolling();
        this.isAnimatingHero = false;

        // Clear all memory lists
        this.processedImages.clear();
        this.allImageUrls = [];
        this.pendingQueue = [];

        // Re-generate a fresh empty grid
        this.generateGrid();

        // Start polling again to get the fresh latest image (like a new start)
        if (this.config.cloudName) {
            setTimeout(() => this.startPolling(), 500);
        }
    }

    adjustOpacity(delta) {
        let newVal = this.config.gridOpacity + delta;
        newVal = Math.max(0, Math.min(1, newVal)); // Clamp between 0 and 1
        this.config.gridOpacity = newVal;

        // Update UI elements
        const slider = document.getElementById('grid-opacity');
        const display = document.getElementById('opacity-val');
        if (slider) slider.value = Math.round(newVal * 100);
        if (display) display.textContent = `${Math.round(newVal * 100)}%`;

        this.updateGridVisuals();
        localStorage.setItem('mosaic_config', JSON.stringify(this.config));
    }

    toggleZenMode() {
        this.isZenMode = !this.isZenMode;
        if (this.isZenMode) {
            document.body.classList.add('zen-view');
            this.settingsBtn.disabled = true;
            this.indicator.classList.add('hidden');
        } else {
            document.body.classList.remove('zen-view');
            this.settingsBtn.disabled = false;
            if (this.isPolling) this.indicator.classList.remove('hidden');
        }
    }

    updateCanvasSize() {
        this.canvas.style.width = `${this.config.canvasWidth}px`;
        this.canvas.style.height = `${this.config.canvasHeight}px`;
        this.handleResize();
    }

    handleResize() {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const targetWidth = this.config.canvasWidth || 1920;
        const targetHeight = this.config.canvasHeight || 1080;
        const targetRatio = targetWidth / targetHeight;
        const currentRatio = windowWidth / windowHeight;

        let scale = 1;

        if (currentRatio > targetRatio) {
            // Window is wider than canvas ratio
            scale = windowHeight / targetHeight;
        } else {
            // Window is taller than canvas ratio
            scale = windowWidth / targetWidth;
        }

        this.canvas.style.transform = `scale(${scale})`;
    }

    /* --- Grid System --- */

    generateGrid() {
        this.gridLayer.innerHTML = '';
        this.gridCells = [];
        this.processedImages.clear();
        this.allImageUrls = [];

        const density = this.config.gridDensity;
        const targetWidth = this.config.canvasWidth || 1920;
        const targetHeight = this.config.canvasHeight || 1080;

        /**
         * Calculate columns and rows based on current canvas aspect ratio
         */
        const cols = Math.floor(Math.sqrt(density * (targetWidth / targetHeight)));
        const rows = Math.floor(density / cols);

        this.gridLayer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        this.gridLayer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        const actualTotal = cols * rows;
        for (let i = 0; i < actualTotal; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-slot';
            cell.style.overflow = 'hidden';
            cell.dataset.index = i;
            this.gridLayer.appendChild(cell);
            this.gridCells.push(cell);
        }

        this.updateGridVisuals();
    }

    updateGridVisuals() {
        // Set CSS variable for opacity
        document.documentElement.style.setProperty('--current-opacity', this.config.gridOpacity);

        // Update existing items
        const items = document.querySelectorAll('.mosaic-item');
        items.forEach(img => {
            img.style.opacity = this.config.gridOpacity;
        });
    }

    /* --- Cloudinary Polling --- */

    startPolling() {
        if (!this.config.cloudName || !this.config.apiKey || !this.config.apiSecret) {
            console.warn("Cloudinary credentials incomplete. Polling disabled.");
            return;
        }

        console.log("Starting polling for Cloudinary...");
        this.isPolling = true;
        if (!this.isZenMode) this.indicator.classList.remove('hidden');
        this.poll();
    }

    stopPolling() {
        this.isPolling = false;
        this.indicator.classList.add('hidden');
        if (this.pollTimer) clearTimeout(this.pollTimer);
    }

    async poll() {
        if (!this.isPolling) return;

        try {
            await this.fetchNewImages();
        } catch (err) {
            console.error("Polling error:", err);
        }

        // Schedule next poll
        this.pollTimer = setTimeout(() => this.poll(), this.config.pollInterval * 1000);
    }

    async fetchNewImages() {
        /**
         * We now call our LOCAL PROXY server to handle the Cloudinary Search.
         * This bypasses the CORS security restriction in browsers.
         */
        const { cloudName, apiKey, apiSecret, folderPath } = this.config;

        // Build search query
        let expression = 'resource_type:image';
        if (folderPath) expression += ` AND folder=${folderPath}`;

        const localUrl = `/api/mosaic/search`;

        try {
            const response = await fetch(localUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cloudName,
                    apiKey,
                    apiSecret,
                    expression
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Server error ${response.status}`);
            }

            const data = await response.json();
            const resources = data.resources || [];

            // First time? 
            const isFirstFetch = this.allImageUrls.length === 0;

            if (isFirstFetch) {
                // On first start: 
                // 1. Mark ALL existing photos as processed
                // 2. Only place the VERY latest one
                resources.forEach(res => {
                    this.processedImages.add(res.public_id);
                    if (!this.allImageUrls.includes(res.secure_url)) {
                        this.allImageUrls.push(res.secure_url);
                    }
                });

                if (resources.length > 0) {
                    const latest = resources[0];
                    console.log(`[Start-up] Only placing the single latest image: ${latest.public_id}`);
                    this.pendingQueue.push(latest); // Queue it up!
                    this.processQueue();
                }
            } else {
                // Subsequent polls: Find ALL truly new ones
                const trulyNew = resources.filter(res => !this.processedImages.has(res.public_id));

                if (trulyNew.length > 0) {
                    // Sort trulyNew so oldest of the new ones comes first in queue (reverse chronological)
                    trulyNew.reverse().forEach(res => {
                        this.processedImages.add(res.public_id);
                        if (!this.allImageUrls.includes(res.secure_url)) {
                            this.allImageUrls.unshift(res.secure_url);
                        }
                        this.pendingQueue.push(res);
                    });

                    console.log(`[Queue] Added ${trulyNew.length} new photos to the VIP queue.`);
                    this.processQueue();
                }
            }
        } catch (error) {
            console.error("Mosaic Wall Fetch failed:", error.message);
        }
    }

    /**
     * Shows images from the queue one by one
     */
    processQueue() {
        if (this.isAnimatingHero || this.pendingQueue.length === 0) return;

        this.isAnimatingHero = true;
        const nextImage = this.pendingQueue.shift();

        console.log(`[Stage-Center] Presenting image: ${nextImage.public_id}`);
        this.placeImageInGrid(nextImage.secure_url, nextImage.public_id, true);
    }

    placeImageInGrid(url, id, animate = false) {
        // Track unique URL
        if (!this.allImageUrls.includes(url)) {
            this.allImageUrls.unshift(url);
        }

        // Randomly pick a cell that is currently empty (if possible) 
        const emptyCells = this.gridCells.filter(c => c.innerHTML === '');
        const targetCell = emptyCells.length > 0
            ? emptyCells[Math.floor(Math.random() * emptyCells.length)]
            : this.gridCells[Math.floor(Math.random() * this.gridCells.length)];

        if (animate) {
            // ANIMATION STEP:
            // 1. Create a "flying" image element for the entrance
            const entranceImg = new Image();
            entranceImg.src = url;
            entranceImg.className = 'mosaic-item-entrance';

            // 2. Initial state: Center and 4x scale
            const targetW = targetCell.offsetWidth;
            const targetH = targetCell.offsetHeight;
            const targetL = targetCell.offsetLeft;
            const targetT = targetCell.offsetTop;

            entranceImg.style.width = `${targetW}px`;
            entranceImg.style.height = `${targetH}px`;
            entranceImg.style.left = `calc(50% - ${targetW / 2}px)`;
            entranceImg.style.top = `calc(50% - ${targetH / 2}px)`;
            entranceImg.style.transform = `scale(4)`;
            entranceImg.style.opacity = 0;

            // Add to canvas wrapper
            this.canvas.appendChild(entranceImg);

            entranceImg.onload = () => {
                requestAnimationFrame(() => {
                    entranceImg.style.opacity = 1;

                    // 3. Glide into the grid position after 800ms
                    setTimeout(() => {
                        entranceImg.style.left = `${targetL}px`;
                        entranceImg.style.top = `${targetT}px`;
                        entranceImg.style.transform = `scale(1)`;

                        // 4. Once it arrives (1.2s total), swap permanently
                        setTimeout(() => {
                            this.setFinalImage(targetCell, url, id);
                            entranceImg.remove();
                        }, 1200);
                    }, 800);
                });
            };
        } else {
            // SIMPLE PLACEMENT (for 8/9 keys)
            const img = new Image();
            img.src = url;
            img.className = 'mosaic-item new';
            img.style.opacity = 0;
            img.onload = () => {
                this.setFinalImage(targetCell, url, id);
            };
        }
    }

    /**
     * Sets the actual image in the grid cell
     */
    setFinalImage(cell, url, id) {
        const finalImg = new Image();
        finalImg.src = url;
        finalImg.className = 'mosaic-item new';
        finalImg.style.opacity = this.config.gridOpacity;

        cell.innerHTML = '';
        cell.dataset.pid = id;
        cell.dataset.url = url;
        cell.classList.add('filled'); // Removes the white background for this cell
        cell.appendChild(finalImg);

        // RELEASE THE STAGE:
        // After this image is set, allow the next hero in the queue to start
        this.isAnimatingHero = false;
        this.processQueue();
    }

    /**
     * fillDuplicates: 
     * - If true: Fills EVERY slot using duplicates if needed (Key 9)
     * - If false: Fills grid with ONE of each unique image from folder (Key 8)
     */
    fillRemainingSlots(fillDuplicates = false) {
        if (this.allImageUrls.length === 0) {
            console.warn("No images discovered yet. Wait for a poll or check settings.");
            return;
        }

        console.log(`Filling slots (randomly, duplicates=${fillDuplicates})...`);

        let filledCount = 0;

        // Find which URLs are ALREADY on the grid to avoid repeats
        const urlsOnGrid = new Set();
        this.gridCells.forEach(cell => {
            if (cell.dataset.url) urlsOnGrid.add(cell.dataset.url);
        });

        // If not filling duplicates (Key 8), only use URLs NOT already on the grid
        let availablePool = fillDuplicates
            ? [...this.allImageUrls]
            : this.allImageUrls.filter(url => !urlsOnGrid.has(url));

        if (availablePool.length === 0 && !fillDuplicates) {
            console.log("All unique images from the folder are already on the grid!");
            return;
        }

        // Find all empty cells and shuffle them to ensure random placement
        const emptyCells = this.gridCells.filter(cell => cell.innerHTML === '').sort(() => Math.random() - 0.5);

        let poolIndex = 0;

        // Iterate through the SHUFFLED empty cells
        for (let i = 0; i < emptyCells.length; i++) {
            const cell = emptyCells[i];
            let imageUrl = '';

            if (fillDuplicates) {
                // Key 9: Pick ANY image from the whole pool for every empty spot
                imageUrl = availablePool[Math.floor(Math.random() * availablePool.length)];
            } else {
                // Key 8: Pick the next unique image that isn't on the grid yet
                if (poolIndex < availablePool.length) {
                    imageUrl = availablePool[poolIndex];
                    poolIndex++;
                } else {
                    break; // No more "new" unique images left for Key 8
                }
            }

            if (!imageUrl) continue;

            const img = new Image();
            img.src = imageUrl;
            img.className = 'mosaic-item new';
            img.style.opacity = 0;

            img.onload = () => {
                cell.dataset.url = imageUrl;
                cell.classList.add('filled'); // Also reveal for manual fill
                cell.appendChild(img);
            };
            filledCount++;
        }

        console.log(`Success: Randomly filled ${filledCount} slots.`);
    }

    /* --- Modal Utils --- */

    openSettings() {
        this.settingsModal.classList.remove('hidden');
    }

    closeSettings() {
        this.settingsModal.classList.add('hidden');
    }
}

// Kickstart!
window.onload = () => {
    window.app = new MosaicWall();
};
