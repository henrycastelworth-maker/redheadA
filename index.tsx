/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from "@google/genai";

// State variables to hold image data throughout the process
type ImageData = { base64: string; mimeType: string; };

let modelImage: ImageData & { file: File | null } = { file: null, base64: '', mimeType: '' };
let cleanedModelImage: ImageData = { base64: '', mimeType: '' };
let outfitImage: ImageData & { file: File | null } = { file: null, base64: '', mimeType: '' };
let isolatedOutfitImage: ImageData = { base64: '', mimeType: '' };
let finalImage: ImageData = { base64: '', mimeType: '' };
let albumImages: ImageData[] = [];

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const ALBUM_STORAGE_KEY = 'virtualTryOnAlbum';

/**
 * Utility to convert a file to a base64 string.
 */
function fileToGenerativePart(file: File): Promise<{mimeType: string, data: string}> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const result = (e.target?.result as string) || '';
        // result is "data:mime/type;base64,..." -> we want just the part after the comma
        const data = result.split(',')[1];
        resolve({ mimeType: file.type, data });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generic function to call the Gemini API for image editing.
 */
async function processImage(
    prompt: string,
    images: { mimeType: string; data: string }[],
    outputImgElement: HTMLImageElement,
    loaderElement: HTMLElement,
    errorElement: HTMLElement,
    controls: (HTMLButtonElement | null)[]
): Promise<ImageData | null> {
    loaderElement.style.display = 'block';
    outputImgElement.style.display = 'none';
    errorElement.textContent = '';
    controls.forEach(btn => btn && (btn.disabled = true));

    try {
        const imageParts = images.map(image => ({
            inlineData: {
                data: image.data,
                mimeType: image.mimeType
            }
        }));

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                parts: [
                    ...imageParts,
                    { text: prompt },
                ],
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
        
        const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

        if (imagePart && imagePart.inlineData) {
            outputImgElement.src = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
        } else {
            throw new Error("No image was generated. The prompt may have been blocked.");
        }

    } catch (e) {
        console.error(e);
        errorElement.textContent = `Error: ${(e as Error).message}`;
        return null;
    } finally {
        loaderElement.style.display = 'none';
        outputImgElement.style.display = 'block';
        controls.forEach(btn => btn && (btn.disabled = false));
    }
}

/**
 * Downloads the image from a base64 string.
 */
function downloadImage(base64: string, mimeType: string, filename: string) {
    const a = document.createElement('a');
    a.href = `data:${mimeType};base64,${base64}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// --- Album Functions ---

function renderAlbum() {
    const albumGrid = document.getElementById('album-grid')!;
    const placeholder = document.getElementById('album-placeholder')!;
    albumGrid.innerHTML = ''; // Clear existing
    
    if (albumImages.length === 0) {
        albumGrid.appendChild(placeholder);
        placeholder.style.display = 'block';
    } else {
        placeholder.style.display = 'none';
        albumImages.forEach((imgData, index) => {
            const item = document.createElement('div');
            item.className = 'album-item';
            
            const img = document.createElement('img');
            img.src = `data:${imgData.mimeType};base64,${imgData.base64}`;
            img.alt = `Saved try-on ${index + 1}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.onclick = () => removeImageFromAlbum(index);
            
            item.appendChild(img);
            item.appendChild(deleteBtn);
            albumGrid.appendChild(item);
        });
    }
}

function saveImageToAlbum() {
    if (finalImage.base64) {
        albumImages.push({ ...finalImage });
        localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(albumImages));
        renderAlbum();
    }
}

function removeImageFromAlbum(index: number) {
    albumImages.splice(index, 1);
    localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(albumImages));
    renderAlbum();
}

function loadAlbumFromStorage() {
    const storedAlbum = localStorage.getItem(ALBUM_STORAGE_KEY);
    if (storedAlbum) {
        albumImages = JSON.parse(storedAlbum);
        renderAlbum();
    }
}


/**
 * Sets up the application and all event listeners.
 */
function initialize() {
    const startOverBtn = document.getElementById('start-over-btn') as HTMLButtonElement;
    startOverBtn.addEventListener('click', () => location.reload());

    // --- Step 1: Model Upload ---
    const modelUploadInput = document.getElementById('model-upload-input') as HTMLInputElement;
    const modelUploadPreview = document.getElementById('model-upload-preview') as HTMLImageElement;
    const step1Section = document.getElementById('step-1-model-upload')!;
    const step2Section = document.getElementById('step-2-model-clean')!;
    const modelCleanInputImg = document.getElementById('model-clean-input-img') as HTMLImageElement;

    modelUploadInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            modelImage.file = file;
            const { data, mimeType } = await fileToGenerativePart(file);
            modelImage.base64 = data;
            modelImage.mimeType = mimeType;

            const objectUrl = URL.createObjectURL(file);
            modelUploadPreview.src = objectUrl;
            modelUploadPreview.style.display = 'block';
            modelCleanInputImg.src = objectUrl;
            
            step1Section.classList.remove('active');
            step1Section.classList.add('completed');
            step2Section.classList.add('active');
        }
    });

    // --- Step 2: Clean Model ---
    const cleanModelBtn = document.getElementById('clean-model-btn') as HTMLButtonElement;
    const retryCleanModelBtn = document.getElementById('retry-clean-model-btn') as HTMLButtonElement;
    const downloadCleanModelBtn = document.getElementById('download-clean-model-btn') as HTMLButtonElement;
    const approveCleanModelBtn = document.getElementById('approve-clean-model-btn') as HTMLButtonElement;
    const modelCleanOutputImg = document.getElementById('model-clean-output-img') as HTMLImageElement;
    const step3Section = document.getElementById('step-3-outfit-upload')!;
    
    const cleanModelAction = async () => {
        const result = await processImage(
            "Remove any accessories from this person's head and face, such as glasses or hats. Do not change their facial features, hair, or proportions. The background should remain the same.",
            [{ mimeType: modelImage.mimeType, data: modelImage.base64 }],
            modelCleanOutputImg,
            step2Section.querySelector('.loader') as HTMLElement,
            step2Section.querySelector('.error-message') as HTMLElement,
            [cleanModelBtn, retryCleanModelBtn, downloadCleanModelBtn, approveCleanModelBtn]
        );
        if (result) {
            cleanedModelImage = result;
            downloadCleanModelBtn.disabled = false;
            approveCleanModelBtn.disabled = false;
        }
    };
    cleanModelBtn.addEventListener('click', cleanModelAction);
    retryCleanModelBtn.addEventListener('click', cleanModelAction);
    downloadCleanModelBtn.addEventListener('click', () => downloadImage(cleanedModelImage.base64, cleanedModelImage.mimeType, 'cleaned_model.png'));
    approveCleanModelBtn.addEventListener('click', () => {
        step2Section.classList.remove('active');
        step2Section.classList.add('completed');
        step3Section.classList.add('active');
    });

    // --- Step 3: Outfit Upload ---
    const outfitUploadInput = document.getElementById('outfit-upload-input') as HTMLInputElement;
    const outfitUploadPreview = document.getElementById('outfit-upload-preview') as HTMLImageElement;
    const step4Section = document.getElementById('step-4-outfit-isolate')!;
    const outfitIsolateInputImg = document.getElementById('outfit-isolate-input-img') as HTMLImageElement;
    
    outfitUploadInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            outfitImage.file = file;
            const { data, mimeType } = await fileToGenerativePart(file);
            outfitImage.base64 = data;
            outfitImage.mimeType = mimeType;

            const objectUrl = URL.createObjectURL(file);
            outfitUploadPreview.src = objectUrl;
            outfitUploadPreview.style.display = 'block';
            outfitIsolateInputImg.src = objectUrl;
            
            step3Section.classList.remove('active');
            step3Section.classList.add('completed');
            step4Section.classList.add('active');
        }
    });

    // --- Step 4: Isolate Outfit ---
    const isolateOutfitBtn = document.getElementById('isolate-outfit-btn') as HTMLButtonElement;
    const retryIsolateOutfitBtn = document.getElementById('retry-isolate-outfit-btn') as HTMLButtonElement;
    const downloadIsolateOutfitBtn = document.getElementById('download-isolate-outfit-btn') as HTMLButtonElement;
    const approveIsolateOutfitBtn = document.getElementById('approve-isolate-outfit-btn') as HTMLButtonElement;
    const outfitIsolateOutputImg = document.getElementById('outfit-isolate-output-img') as HTMLImageElement;
    const step5Section = document.getElementById('step-5-combine')!;
    
    const isolateOutfitAction = async () => {
        const result = await processImage(
            "Isolate the complete outfit from this image. Remove the person wearing it and the background, leaving only the clothes on a neutral, solid-color background.",
            [{ mimeType: outfitImage.mimeType, data: outfitImage.base64 }],
            outfitIsolateOutputImg,
            step4Section.querySelector('.loader') as HTMLElement,
            step4Section.querySelector('.error-message') as HTMLElement,
            [isolateOutfitBtn, retryIsolateOutfitBtn, downloadIsolateOutfitBtn, approveIsolateOutfitBtn]
        );
        if (result) {
            isolatedOutfitImage = result;
            downloadIsolateOutfitBtn.disabled = false;
            approveIsolateOutfitBtn.disabled = false;
        }
    };
    isolateOutfitBtn.addEventListener('click', isolateOutfitAction);
    retryIsolateOutfitBtn.addEventListener('click', isolateOutfitAction);
    downloadIsolateOutfitBtn.addEventListener('click', () => downloadImage(isolatedOutfitImage.base64, isolatedOutfitImage.mimeType, 'isolated_outfit.png'));
    approveIsolateOutfitBtn.addEventListener('click', () => {
        (document.getElementById('combine-input-model-img') as HTMLImageElement).src = `data:${cleanedModelImage.mimeType};base64,${cleanedModelImage.base64}`;
        (document.getElementById('combine-input-outfit-img') as HTMLImageElement).src = `data:${isolatedOutfitImage.mimeType};base64,${isolatedOutfitImage.base64}`;
        step4Section.classList.remove('active');
        step4Section.classList.add('completed');
        step5Section.classList.add('active');
    });

    // --- Step 5: Combine ---
    const combineBtn = document.getElementById('combine-btn') as HTMLButtonElement;
    const retryCombineBtn = document.getElementById('retry-combine-btn') as HTMLButtonElement;
    const downloadCombineBtn = document.getElementById('download-combine-btn') as HTMLButtonElement;
    const saveAlbumBtn = document.getElementById('save-album-btn') as HTMLButtonElement;
    const tryAnotherOutfitBtn = document.getElementById('try-another-outfit-btn') as HTMLButtonElement;
    const combineOutputImg = document.getElementById('combine-output-img') as HTMLImageElement;

    const combineAction = async () => {
        const result = await processImage(
            "Carefully place the outfit from the second image onto the person in the first image. The outfit should fit naturally. Do not alter the person's face, body shape, proportions, skin tone, or hair. Preserve the background from the first image.",
            [
                { mimeType: cleanedModelImage.mimeType, data: cleanedModelImage.base64 },
                { mimeType: isolatedOutfitImage.mimeType, data: isolatedOutfitImage.base64 }
            ],
            combineOutputImg,
            step5Section.querySelector('.loader') as HTMLElement,
            step5Section.querySelector('.error-message') as HTMLElement,
            [combineBtn, retryCombineBtn, downloadCombineBtn, saveAlbumBtn]
        );
        if (result) {
            finalImage = result;
            downloadCombineBtn.disabled = false;
            saveAlbumBtn.disabled = false;
        }
    };
    combineBtn.addEventListener('click', combineAction);
    retryCombineBtn.addEventListener('click', combineAction);
    downloadCombineBtn.addEventListener('click', () => downloadImage(finalImage.base64, finalImage.mimeType, 'final_try_on.png'));
    saveAlbumBtn.addEventListener('click', saveImageToAlbum);
    tryAnotherOutfitBtn.addEventListener('click', () => {
        // Deactivate later steps
        step4Section.classList.remove('active', 'completed');
        step5Section.classList.remove('active', 'completed');
        
        // Reactivate step 3
        step3Section.classList.add('active');
        step3Section.classList.remove('completed');

        // Reset inputs and outputs for steps 3, 4, 5
        outfitUploadInput.value = '';
        outfitUploadPreview.style.display = 'none';
        outfitUploadPreview.src = '';
        
        outfitIsolateOutputImg.style.display = 'none';
        outfitIsolateOutputImg.src = '';
        downloadIsolateOutfitBtn.disabled = true;
        approveIsolateOutfitBtn.disabled = true;

        combineOutputImg.style.display = 'none';
        combineOutputImg.src = '';
        downloadCombineBtn.disabled = true;
        saveAlbumBtn.disabled = true;
    });

    // --- Initial Load ---
    loadAlbumFromStorage();
}

initialize();