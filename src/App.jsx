import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import JSZip from 'jszip';
import './App.css';
import { parseRockInput } from './utils/parser';
import SlidePreview, { LAYOUTS } from './components/SlidePreview';
import PhotoCropper from './components/PhotoCropper';

const TEXT_COLOR = '#003A5D';
const BORDER_COLOR = '#FFFFFF';
const BORDER_THICKNESS = 8;

const toTitleCase = (str) => {
  if (!str) return '';
  return str.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

// Helper to parse filename formatting: e.g., "1 Catherine Plummer 9.png"
const parseFilenamePattern = (filename) => {
  const base = filename.replace(/\.[^/.]+$/, '').trim();
  const parts = base.split('_');
  if (parts.length >= 3) {
    // Find the part representing the service time (e.g., "900am", "1115am", "400pm")
    const serviceIdx = parts.findIndex(p => /^\d+(am|pm)$/i.test(p));
    if (serviceIdx !== -1 && serviceIdx >= 2) {
      const nameParts = parts.slice(0, serviceIdx);
      const lastName = nameParts[nameParts.length - 1].trim();
      const firstName = nameParts.slice(0, nameParts.length - 1).join(' ').trim();
      const serviceCode = parts[serviceIdx].toLowerCase();
      
      let serviceTime = '9:00 AM';
      if (serviceCode.startsWith('9')) serviceTime = '9:00 AM';
      else if (serviceCode.startsWith('11')) serviceTime = '11:15 AM';
      else if (serviceCode.startsWith('4')) serviceTime = '4:00 PM';
      
      return { firstName, lastName, name: `${firstName} ${lastName}`, serviceTime };
    }
  }
  // Fallback pattern matching
  const match = base.match(/^(\d+)?[_\-\s]*(.+?)[_\-\s]*(\d+)?$/);
  if (match) {
    const nameStr = match[2].replace(/[_\-]+/g, ' ').trim();
    const nameParts = nameStr.split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const serviceCode = match[3] || '9';
    
    let serviceTime = '9:00 AM';
    if (serviceCode === '9') serviceTime = '9:00 AM';
    else if (serviceCode === '11') serviceTime = '11:15 AM';
    else if (serviceCode === '4') serviceTime = '4:00 PM';
    
    return { firstName, lastName, name: nameStr, serviceTime };
  }
  return null;
};

export default function App() {
  const [candidates, setCandidates] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [activeTab, setActiveTab] = useState('9:00 AM'); // '9:00 AM', '11:15 AM', or '4:00 PM'
  const [peoplePerSlide, setPeoplePerSlide] = useState('auto'); // default auto-balance
  const [outputMode, setOutputMode] = useState('1920x1080'); // '1920x1080' or '7920x1650'
  
  // Slide grouping state: { '9:00 AM': [], '11:15 AM': [], '4:00 PM': [] }
  const [slides, setSlides] = useState({ '9:00 AM': [], '11:15 AM': [], '4:00 PM': [] });
  
  // Crop editor state
  const [editingPhoto, setEditingPhoto] = useState(null); // { slideId, personIdx }

  // Background template Image element cache
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateImgEl, setTemplateImgEl] = useState(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState('');

  // Load template image on startup (check custom template cache first)
  useEffect(() => {
    const customTemplate = localStorage.getItem('custom_template_data');
    const img = new Image();
    img.src = customTemplate || '/template.png';
    img.onload = () => {
      setTemplateImgEl(img);
      setTemplateLoaded(true);
    };
    img.onerror = () => {
      if (customTemplate) {
        const fallback = new Image();
        fallback.src = '/template.png';
        fallback.onload = () => {
          setTemplateImgEl(fallback);
          setTemplateLoaded(true);
        };
      }
    };
  }, []);

  const handleTemplateUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    img.onload = () => {
      setTemplateImgEl(img);
      setTemplateLoaded(true);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          localStorage.setItem('custom_template_data', reader.result);
          triggerToast('Saved custom background template!');
        } catch (err) {
          console.warn('Failed to save template to localStorage:', err);
          triggerToast('Loaded background template (not cached).');
        }
      };
      reader.readAsDataURL(file);
    };
  };

  const handleResetTemplate = () => {
    localStorage.removeItem('custom_template_data');
    const img = new Image();
    img.src = '/template.png?t=' + Date.now(); // Cache bust the reload
    img.onload = () => {
      setTemplateImgEl(img);
      setTemplateLoaded(true);
      triggerToast('Reset to default background template!');
    };
  };

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Re-layouts all candidates into slides based on current chunk size
  const autoLayoutCandidates = (candidateList, perSlide, forceMode = outputMode) => {
    const services = ['9:00 AM', '11:15 AM', '4:00 PM'];
    const newSlides = { '9:00 AM': [], '11:15 AM': [], '4:00 PM': [] };

    services.forEach((service) => {
      const filtered = [...candidateList.filter(c => c.serviceTime === service)];
      
      // Sort candidates by custom sortOrder
      filtered.sort((a, b) => {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });

      const N = filtered.length;
      if (N === 0) return;

      if (forceMode === '7920x1650') {
        // LED Strip Mode: All candidates of this service on exactly 1 widescreen slide
        newSlides[service].push({
          id: `${service.replace(/[^a-z0-9]/gi, '')}_slide_led`,
          people: filtered
        });
      } else {
        if (perSlide === 'auto') {
          // Auto-Balance strategy:
          // - N <= 4: 1 slide of size N
          // - 4 < N <= 8: 2 slides of size N/2 balanced
          // - N > 8: math.ceil(N/4) slides of size N/S balanced
          const S = Math.ceil(N / 4);
          const base = Math.floor(N / S);
          const rem = N % S;
          let currentIndex = 0;
          
          for (let s = 0; s < S; s++) {
            const size = s < rem ? base + 1 : base;
            const chunk = filtered.slice(currentIndex, currentIndex + size);
            currentIndex += size;
            newSlides[service].push({
              id: `${service.replace(/[^a-z0-9]/gi, '')}_slide_${s}`,
              people: chunk
            });
          }
        } else {
          // Numeric per-slide strategy (K per slide)
          const K = parseInt(perSlide, 10) || 2;
          for (let i = 0; i < N; i += K) {
            const chunk = filtered.slice(i, i + K);
            newSlides[service].push({
              id: `${service.replace(/[^a-z0-9]/gi, '')}_slide_${i / K}`,
              people: chunk
            });
          }
        }
      }
    });

    setSlides(newSlides);
  };

  // Synchronize candidates list and slides with uploaded photos
  useEffect(() => {
    // If any photo is missing sortOrder, initialize them sequentially (default to alphabetical by last name per service)
    let needsUpdate = false;
    photos.forEach((p) => {
      if (p.sortOrder === undefined || p.sortOrder === null) {
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      const servicesOrder = ['9:00 AM', '11:15 AM', '4:00 PM'];
      const parsedPhotos = photos.map(p => {
        const parsed = parseFilenamePattern(p.name) || { firstName: '', lastName: '', serviceTime: '9:00 AM' };
        return {
          ...p,
          firstName: p.firstName || parsed.firstName,
          lastName: p.lastName || parsed.lastName,
          service: p.service || parsed.serviceTime
        };
      });

      // Sort: service group first, then alphabetical by last name
      parsedPhotos.sort((a, b) => {
        const sA = servicesOrder.indexOf(a.service);
        const sB = servicesOrder.indexOf(b.service);
        if (sA !== sB) return sA - sB;

        const lastA = (a.lastName || '').toLowerCase();
        const lastB = (b.lastName || '').toLowerCase();
        if (lastA < lastB) return -1;
        if (lastA > lastB) return 1;

        const firstA = (a.firstName || '').toLowerCase();
        const firstB = (b.firstName || '').toLowerCase();
        if (firstA < firstB) return -1;
        if (firstA > firstB) return 1;
        return 0;
      });

      // Map back to photos state with sequential sortOrder
      const finalPhotos = photos.map((origPhoto) => {
        const sortedIdx = parsedPhotos.findIndex(p => p.name === origPhoto.name);
        return {
          ...origPhoto,
          sortOrder: sortedIdx
        };
      });

      setPhotos(finalPhotos);
      return;
    }

    const newCandidates = photos.map((photo) => {
      let first = photo.firstName;
      let last = photo.lastName;
      let service = photo.service || '9:00 AM';

      if (!first && !last) {
        const parsed = parseFilenamePattern(photo.name);
        if (parsed) {
          first = parsed.firstName;
          last = parsed.lastName;
          service = parsed.serviceTime;
        } else {
          const clean = photo.name.replace(/\.[^/.]+$/, '').replace(/^[0-9]+[_\-\s]+/, '').replace(/[_\-\s]+[0-9]+$/, '').replace(/[_\-]+/g, ' ').trim();
          first = clean.split(' ')[0] || '';
          last = clean.split(' ').slice(1).join(' ') || '';
        }
      }

      const fullName = `${first} ${last}`.trim();

      return {
        id: photo.name,
        fullName: fullName,
        firstName: first,
        lastName: last,
        serviceTime: service,
        imageFile: photo,
        sortOrder: photo.sortOrder || 0,
        zoom: photo.zoom || 1,
        panX: photo.panX || 0,
        panY: photo.panY || 0
      };
    });

    setCandidates(newCandidates);
    autoLayoutCandidates(newCandidates, peoplePerSlide, outputMode);
  }, [photos, peoplePerSlide, outputMode]);

  // Handle Photo files upload
  const handlePhotoUpload = (e) => {
    const allFiles = Array.from(e.target.files || []);
    const files = allFiles.filter(file => file.type.startsWith('image/'));
    
    if (files.length === 0) {
      triggerToast('No image files found in selection!');
      return;
    }

    const newPhotos = [];
    let loadedCount = 0;

    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      
      const checkCompletion = () => {
        loadedCount++;
        if (loadedCount === files.length) {
          setPhotos((prev) => [...prev, ...newPhotos]);
          triggerToast(`Uploaded and processed ${newPhotos.length} photos!`);
        }
      };

      img.onload = () => {
        const parsedMeta = parseFilenamePattern(file.name);
        const photoObj = {
          name: file.name,
          cleanName: parsedMeta ? parsedMeta.name.toLowerCase().replace(/[^a-z0-9]/g, '') : file.name.toLowerCase().replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/g, ''),
          firstName: parsedMeta ? parsedMeta.firstName : '',
          lastName: parsedMeta ? parsedMeta.lastName : '',
          url: url,
          _element: img,
          service: parsedMeta ? parsedMeta.serviceTime : null,
          zoom: 1,
          panX: 0,
          panY: 0
        };
        newPhotos.push(photoObj);
        checkCompletion();
      };

      img.onerror = () => {
        console.error('Failed to load image:', file.name);
        checkCompletion();
      };
    });
  };

  const removePhoto = (photoName) => {
    setPhotos((prev) => prev.filter((p) => p.name !== photoName));
  };

  // Load Mock / Sample Data for local previewing
  const handleLoadSamples = () => {
    const sampleFiles = [
      { name: 'Jane_Smith_900am_20260816.png', file: 'Jane_Smith_900am_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'Mary_Jones_900am_20260816.png', file: 'Mary_Jones_900am_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'John_Smith_900am_20260816.png', file: 'John_Smith_900am_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'Emily_Davis_1115am_20260816.png', file: 'Emily_Davis_1115am_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'Michael_Taylor_1115am_20260816.png', file: 'Michael_Taylor_1115am_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'Sarah_Thomas_400pm_20260816.png', file: 'Sarah_Thomas_400pm_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'David_Wilson_400pm_20260816.png', file: 'David_Wilson_400pm_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'James_Miller_400pm_20260816.png', file: 'James_Miller_400pm_20260816.png', zoom: 1, panX: 0, panY: 0 },
      { name: 'Lisa_Brown_400pm_20260816.png', file: 'Lisa_Brown_400pm_20260816.png', zoom: 1, panX: 0, panY: 0 }
    ];

    let loadedCount = 0;
    const loadedPhotos = [];

    sampleFiles.forEach((sample) => {
      const img = new Image();
      img.src = `/samples/${sample.file}`;
      img.onload = () => {
        const parsedMeta = parseFilenamePattern(sample.name);
        loadedPhotos.push({
          name: sample.name,
          cleanName: parsedMeta ? parsedMeta.name.toLowerCase().replace(/[^a-z0-9]/g, '') : sample.name.toLowerCase(),
          firstName: parsedMeta ? parsedMeta.firstName : '',
          lastName: parsedMeta ? parsedMeta.lastName : '',
          url: img.src,
          _element: img,
          service: parsedMeta ? parsedMeta.serviceTime : null,
          zoom: sample.zoom,
          panX: sample.panX,
          panY: sample.panY
        });
        loadedCount++;

        if (loadedCount === sampleFiles.length) {
          setPhotos(loadedPhotos);
          triggerToast('Loaded sample candidate data and matched photos!');
        }
      };
    });
  };

  const handleMoveCandidate = (candidateId, direction) => {
    // Find the candidate
    const targetCand = candidates.find(c => c.id === candidateId);
    if (!targetCand) return;
    
    const service = targetCand.serviceTime;
    // Get all candidates of this service, sorted by current sortOrder
    const serviceCands = candidates
      .filter(c => c.serviceTime === service)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      
    const idx = serviceCands.findIndex(c => c.id === candidateId);
    if (idx === -1) return;
    
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= serviceCands.length) return;
    
    const swapCand = serviceCands[swapIdx];
    
    // Swap their sortOrder inside the photos state
    setPhotos((prev) => {
      return prev.map((p) => {
        if (p.name === targetCand.id) {
          return { ...p, sortOrder: swapCand.sortOrder };
        }
        if (p.name === swapCand.id) {
          return { ...p, sortOrder: targetCand.sortOrder };
        }
        return p;
      });
    });
  };

  // Re-layout triggering on layout count change
  const handleLayoutChange = (e) => {
    const val = e.target.value;
    setPeoplePerSlide(val);
    autoLayoutCandidates(candidates, val);
    triggerToast(val === 'auto' ? 'Regenerated layouts: Auto-Balanced' : `Regenerated layouts: ${val} per slide.`);
  };

  // Assign photo to a slide's specific person slot
  const handleAssignPhoto = (slideId, personIdx, photoObj) => {
    setSlides((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((service) => {
        updated[service] = updated[service].map((slide) => {
          if (slide.id !== slideId) return slide;
          const people = [...slide.people];
          people[personIdx] = {
            ...people[personIdx],
            imageFile: photoObj
          };
          return { ...slide, people };
        });
      });
      return updated;
    });
    triggerToast('Matched photo to slide card!');
  };

  // Open cropping tool modal
  const handleEditPhoto = (slideId, personIdx) => {
    setEditingPhoto({ slideId, personIdx });
  };

  // Save crop adjustments for all people on a slide
  const handleUpdateCrop = (slideId, draftCropsArray) => {
    const slide = [...slides['9:00 AM'], ...slides['11:15 AM'], ...slides['4:00 PM']].find(s => s.id === slideId);
    if (!slide) return;

    setPhotos((prev) =>
      prev.map((photo) => {
        const personIdx = slide.people.findIndex(p => p.imageFile && p.imageFile.name === photo.name);
        if (personIdx !== -1 && draftCropsArray[personIdx]) {
          const crop = draftCropsArray[personIdx];
          return { ...photo, zoom: crop.zoom, panX: crop.panX, panY: crop.panY };
        }
        return photo;
      })
    );
    triggerToast('Applied slide crop adjustments!');
  };

  // Add a new empty slide to current service
  const handleAddNewSlide = () => {
    setSlides((prev) => {
      const updated = { ...prev };
      updated[activeTab] = [
        ...updated[activeTab],
        {
          id: `${activeTab.replace(/[^a-z0-9]/gi, '')}_slide_custom_${Date.now()}`,
          people: []
        }
      ];
      return updated;
    });
    triggerToast('Added new slide!');
  };

  // Delete slide
  const handleDeleteSlide = (slideId) => {
    setSlides((prev) => {
      const updated = { ...prev };
      updated[activeTab] = updated[activeTab].filter(s => s.id !== slideId);
      return updated;
    });
    triggerToast('Deleted slide');
  };

  // Export current service slides to ZIP
  // Export current service slides as raw PNG files (individual downloads)
  const handleExportSlides = async () => {
    const activeSlides = slides[activeTab] || [];
    if (activeSlides.length === 0) {
      triggerToast('No slides to export.');
      return;
    }

    const isLED = outputMode === '7920x1650';
    const exportW = isLED ? 7920 : 1920;
    const exportH = isLED ? 1650 : 1080;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportW;
    exportCanvas.height = exportH;
    const ctx = exportCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    triggerToast('Generating and downloading graphics... please wait.');

    const getLEDLayout = (N) => {
      if (N === 0) return [];
      const layoutArray = [];
      const slotWidth = 7920 / N;
      const gap = 80;
      const maxBoxSize = 850;
      const size = Math.min(maxBoxSize, slotWidth - gap);
      const textHeight = Math.max(30, Math.min(55, size * 0.065)) * 3.5;
      const spacing = 80;
      const totalHeight = size + spacing + textHeight;
      const yStart = (1650 - totalHeight) / 2;
      
      for (let i = 0; i < N; i++) {
        const slotX = i * slotWidth;
        const x = slotX + (slotWidth - size) / 2;
        layoutArray.push({ x, y: yStart, size });
      }
      return layoutArray;
    };

    let index = 1;
    for (const slide of activeSlides) {
      // Clear
      ctx.clearRect(0, 0, exportW, exportH);
      
      // Draw background
      if (isLED) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, exportW, exportH);
      } else {
        if (templateLoaded && templateImgEl) {
          ctx.drawImage(templateImgEl, 0, 0, exportW, exportH);
        } else {
          ctx.fillStyle = '#F4F2EF';
          ctx.fillRect(0, 0, exportW, exportH);
          ctx.fillStyle = '#B9D2DC';
          ctx.fillRect(0, 750, exportW, 330);
        }
      }

      // Draw people
      const N = slide.people.length;
      const layout = isLED ? getLEDLayout(N) : (LAYOUTS[N] || []);

      for (let i = 0; i < N; i++) {
        const person = slide.people[i];
        const box = layout[i];
        if (!box) continue;

        const { x, y, size } = box;
        const borderThick = isLED ? Math.max(8, Math.round(size * 0.02)) : BORDER_THICKNESS;
        const innerX = x + borderThick;
        const innerY = y + borderThick;
        const innerSize = size - 2 * borderThick;

        if (person.imageFile) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(innerX, innerY, innerSize, innerSize);
          ctx.clip();

          const img = person.imageFile._element;
          if (img) {
            const zoom = person.zoom || 1;
            const panX = person.panX || 0;
            const panY = person.panY || 0;

            const imgW = img.width;
            const imgH = img.height;

            let renderW, renderH;
            if (imgW < imgH) {
              renderW = innerSize;
              renderH = imgH * (innerSize / imgW);
            } else {
              renderH = innerSize;
              renderW = imgW * (innerSize / imgH);
            }

            renderW *= zoom;
            renderH *= zoom;

            const renderX = innerX + (innerSize - renderW) / 2 + panX;
            const renderY = innerY + (innerSize - renderH) / 2 + panY;

            ctx.drawImage(img, renderX, renderY, renderW, renderH);
          }
          ctx.restore();
        } else {
          ctx.fillStyle = '#E2E8F0';
          ctx.fillRect(innerX, innerY, innerSize, innerSize);
        }

        // Draw white border
        ctx.lineWidth = borderThick;
        ctx.strokeStyle = BORDER_COLOR;
        ctx.strokeRect(x + borderThick/2, y + borderThick/2, size - borderThick, size - borderThick);

        // Thin outer gray outline for LED mode
        if (isLED) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#E2E8F0';
          ctx.strokeRect(x, y, size, size);
        }

        // Draw names
        ctx.textAlign = 'center';
        const textX = x + size / 2;
        ctx.fillStyle = TEXT_COLOR;

        if (isLED) {
          const fontSize = Math.round(size * 0.065);
          ctx.font = `700 ${fontSize}px Lato, sans-serif`;
          ctx.fillText(toTitleCase(person.firstName), textX, y + size + fontSize * 1.6);

          ctx.font = `300 ${fontSize}px Lato, sans-serif`;
          ctx.fillText(toTitleCase(person.lastName), textX, y + size + fontSize * 2.8);
        } else {
          ctx.font = '700 60px Lato, sans-serif';
          ctx.fillText(toTitleCase(person.firstName), textX, 910);

          ctx.font = '300 60px Lato, sans-serif';
          ctx.fillText(toTitleCase(person.lastName), textX, 980);
        }
      }

      // Convert canvas to Blob
      const blob = await new Promise((resolve) => {
        exportCanvas.toBlob((b) => resolve(b), 'image/png');
      });

      // Download directly as PNG
      const filename = isLED 
        ? `${activeTab.replace(/[^a-z0-9]/gi, '')}_led_strip.png`
        : `${activeTab.replace(/[^a-z0-9]/gi, '')}_slide_${index.toString().padStart(2, '0')}.png`;
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(downloadUrl);

      index++;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Celebration Confetti!
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 }
    });

    triggerToast('All slides exported and downloaded successfully!');
  };



  const copyFullNames = (service) => {
    const sortedCands = candidates
      .filter(c => c.serviceTime === service)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const namesText = sortedCands.map(c => c.fullName).join(', ');
    if (!namesText) {
      triggerToast('No names to copy!');
      return;
    }
    navigator.clipboard.writeText(namesText);
    triggerToast(`Copied ${service} full names to clipboard!`);
  };

  const copyFirstNames = (service) => {
    const sortedCands = candidates
      .filter(c => c.serviceTime === service)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const namesText = sortedCands.map(c => c.firstName).join(', ');
    if (!namesText) {
      triggerToast('No names to copy!');
      return;
    }
    navigator.clipboard.writeText(namesText);
    triggerToast(`Copied ${service} first names to clipboard!`);
  };

  // Reset all state
  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all candidates and photos?')) {
      setCandidates([]);
      setPhotos([]);
      setSlides({ '9:00 AM': [], '11:15 AM': [], '4:00 PM': [] });
      triggerToast('Cleared all data.');
    }
  };

  // Find active editing photo
  const editingSlide = editingPhoto
    ? [...slides['9:00 AM'], ...slides['11:15 AM'], ...slides['4:00 PM']].find(s => s.id === editingPhoto.slideId)
    : null;

  return (
    <div className="app-container">
      {/* Decorative Glow Backgrounds */}
      <div className="bg-glow-1"></div>
      <div className="bg-glow-2"></div>

      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="logo-icon" style={{ background: 'transparent', boxShadow: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="32" height="32" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FFFFFF" d="M21.6667 0H8.33333C3.58333 0 0 3.58333 0 8.33333V21.6667C0 26.4167 3.58333 30 8.33333 30H21.6667C26.4167 30 30 26.4167 30 21.6667V8.33333C30 3.58333 26.4167 0 21.6667 0ZM27.5 21.3333C27.5 24.75 24.75 27.5 21.3333 27.5H8.66667C5.25 27.5 2.5 24.75 2.5 21.3333V17.6667C3.33333 17 5.33333 15.9167 8.33333 15.9167C8.75 15.9167 9.25 15.9167 9.75 16L11.25 21.6667C11.4167 22.25 11.9167 22.5833 12.4167 22.5833C13 22.5833 13.4167 22.1667 13.5833 21.6667C13.5833 21.6667 14.0833 19.5 14.75 17C14.9167 17.0833 15.1667 17.0833 15.3333 17.1667C15.4167 17.1667 15.5 17.1667 15.5 17.25C16.0833 19.6667 16.5833 21.6667 16.5833 21.6667C16.75 22.25 17.1667 22.5833 17.75 22.5833C18.3333 22.5833 18.75 22.1667 18.9167 21.6667L19.8333 18.1667C22.4167 18.5833 25 18.5 27.5833 17V21.3333H27.5ZM27.5 14C25.1667 15.8333 22.8333 16.0833 20.4167 15.6667L21.75 10.5C21.9167 9.83333 21.5 9.16667 20.9167 9C20.25 8.83333 19.5833 9.25 19.4167 9.91667C19.4167 9.91667 18.75 12.5 18.0833 15.25C17.9167 15.1667 17.75 15.1667 17.5833 15.0833C16.9167 12.4167 16.3333 9.91667 16.3333 9.91667C16.1667 9.33333 15.75 9 15.1667 9C14.5833 9 14.1667 9.41667 14 9.91667C14 9.91667 13.5833 11.75 13 13.9167C12.5833 13.8333 12.1667 13.75 11.6667 13.6667C11.0833 11.5833 10.6667 9.91667 10.6667 9.91667C10.5 9.25 9.83333 8.83333 9.16667 9.08333C8.5 9.25 8.16667 9.91667 8.33333 10.5833L9.08333 13.3333H8.41667C5.83333 13.3333 3.91667 14 2.58333 14.75V8.75C2.5 5.25 5.25 2.5 8.66667 2.5H21.25C24.6667 2.5 27.4167 5.25 27.4167 8.66667V14H27.5Z"/>
            </svg>
          </div>
          <div>
            <h1>Watermark Baptism Graphics</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Automated Slide Compositor • 1920x1080 HD</p>
          </div>
        </div>
        <div className="header-actions">
          <label className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>
            🖼️ Change Template
            <input
              type="file"
              accept="image/*"
              onChange={handleTemplateUpload}
              style={{ display: 'none' }}
            />
          </label>
          <button className="btn-secondary" onClick={handleResetTemplate} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            🔄 Reset Template
          </button>
          <button className="btn-secondary" onClick={handleClearAll} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            Reset App
          </button>
          <button className="btn-primary" onClick={handleLoadSamples} style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>
            ⚡ Load Sample Data
          </button>
        </div>
      </header>

      {/* Workspace Grid */}
      <div className="app-workspace">
        
        {/* Left column / Sidebar */}
        <aside className="app-sidebar">
                 {/* Step 1: Upload Photos */}
          <div className="glass-panel">
            <h3 className="panel-title">
              1. Upload Candidate Photos
              <span className="badge">{photos.length} Files</span>
            </h3>
            <label className="upload-zone">
              <input
                type="file"
                multiple
                webkitdirectory="true"
                directory="true"
                onChange={handlePhotoUpload}
                style={{ display: 'none' }}
              />
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: '0 auto 0.5rem' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
              <div className="upload-text">
                <strong>Click to Upload Folder</strong> or select files
              </div>
            </label>

            {photos.length > 0 && (
              <div className="photo-file-list">
                {photos.map((p) => (
                  <div key={p.name} className="photo-file-item">
                    <img src={p.url} alt={p.name} />
                    <button className="btn-remove-file" onClick={() => removePhoto(p.name)}>&times;</button>
                    <div className="file-badge">{p.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Copyable Rosters Output */}
          <div className="glass-panel" style={{ flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column' }}>
            <h3 className="panel-title">
              2. Generated Rosters
              <span className="badge">{candidates.length} Total</span>
            </h3>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingRight: '0.25rem' }}>
              {candidates.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                  Upload photo files to generate rosters.
                </div>
              ) : (
                ['9:00 AM', '11:15 AM', '4:00 PM'].map((group) => {
                  const groupCands = candidates
                    .filter(c => c.serviceTime === group)
                    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                  if (groupCands.length === 0) return null;
                  
                  return (
                    <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-teal)' }}>
                          {group} Service ({groupCands.length})
                        </span>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            onClick={() => copyFullNames(group)}
                            style={{
                              background: 'rgba(0, 242, 254, 0.08)',
                              border: '1px solid rgba(0, 242, 254, 0.25)',
                              borderRadius: '4px',
                              color: 'var(--accent-teal)',
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.35rem',
                              cursor: 'pointer'
                            }}
                          >
                            Copy Full Names
                          </button>
                          <button
                            onClick={() => copyFirstNames(group)}
                            style={{
                              background: 'rgba(0, 242, 254, 0.08)',
                              border: '1px solid rgba(0, 242, 254, 0.25)',
                              borderRadius: '4px',
                              color: 'var(--accent-teal)',
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.35rem',
                              cursor: 'pointer'
                            }}
                          >
                            Copy First Names
                          </button>
                        </div>
                      </div>
                      <textarea
                        readOnly
                        value={groupCands.map(c => c.fullName).join(', ')}
                        style={{
                          width: '100%',
                          height: '80px',
                          background: 'rgba(7, 10, 19, 0.4)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          padding: '0.4rem',
                          fontSize: '0.8rem',
                          fontFamily: 'inherit',
                          resize: 'none',
                          outline: 'none'
                        }}
                      />
                      
                      {/* Interactive Reordering List */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem', maxHeight: '150px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '6px', padding: '0.25rem' }}>
                        {groupCands.map((cand, candIdx) => (
                          <div 
                            key={cand.id} 
                            style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              background: 'rgba(255, 255, 255, 0.02)', 
                              padding: '0.25rem 0.4rem', 
                              borderRadius: '4px', 
                              fontSize: '0.75rem' 
                            }}
                          >
                            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '170px', color: 'var(--text-secondary)' }}>
                              {cand.fullName}
                            </span>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              <button 
                                disabled={candIdx === 0} 
                                onClick={() => handleMoveCandidate(cand.id, -1)}
                                style={{ 
                                  background: 'none', 
                                  border: 'none', 
                                  color: candIdx === 0 ? 'var(--text-secondary)' : 'var(--accent-teal)', 
                                  cursor: candIdx === 0 ? 'default' : 'pointer', 
                                  opacity: candIdx === 0 ? 0.35 : 1,
                                  fontSize: '0.7rem',
                                  padding: '2px'
                                }}
                                title="Move Up"
                              >
                                ▲
                              </button>
                              <button 
                                disabled={candIdx === groupCands.length - 1} 
                                onClick={() => handleMoveCandidate(cand.id, 1)}
                                style={{ 
                                  background: 'none', 
                                  border: 'none', 
                                  color: candIdx === groupCands.length - 1 ? 'var(--text-secondary)' : 'var(--accent-teal)', 
                                  cursor: candIdx === groupCands.length - 1 ? 'default' : 'pointer', 
                                  opacity: candIdx === groupCands.length - 1 ? 0.35 : 1,
                                  fontSize: '0.7rem',
                                  padding: '2px'
                                }}
                                title="Move Down"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </aside>

        {/* Main content grid display */}
        <main className="app-content">
          <div className="tabs-container">
            <div className="tabs">
              <button
                className={`tab-btn ${activeTab === '9:00 AM' ? 'active' : ''}`}
                onClick={() => setActiveTab('9:00 AM')}
              >
                9:00 AM
                <span className="slide-count-badge">{slides['9:00 AM']?.length || 0}</span>
              </button>
              <button
                className={`tab-btn ${activeTab === '11:15 AM' ? 'active' : ''}`}
                onClick={() => setActiveTab('11:15 AM')}
              >
                11:15 AM
                <span className="slide-count-badge">{slides['11:15 AM']?.length || 0}</span>
              </button>
              <button
                className={`tab-btn ${activeTab === '4:00 PM' ? 'active' : ''}`}
                onClick={() => setActiveTab('4:00 PM')}
              >
                4:00 PM
                <span className="slide-count-badge">{slides['4:00 PM']?.length || 0}</span>
              </button>
            </div>

            {/* Slide settings and bulk actions */}
            <div className="controls-panel">
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                Display Mode:
                <select
                  value={outputMode}
                  onChange={(e) => {
                    const newMode = e.target.value;
                    setOutputMode(newMode);
                    triggerToast(newMode === '7920x1650' ? 'Switched to 7920x1650 LED Strip Mode' : 'Switched to 1920x1080 slide mode');
                  }}
                  style={{ marginLeft: '0.5rem', marginRight: '1.25rem' }}
                >
                  <option value="1920x1080">Option 1: 1920x1080 Slide Show</option>
                  <option value="7920x1650">Option 2: 7920x1650 LED Strip</option>
                </select>
              </label>

              {outputMode !== '7920x1650' && (
                <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700, marginRight: '1rem' }}>
                  Default Layout:
                  <select
                    value={peoplePerSlide}
                    onChange={handleLayoutChange}
                    style={{ marginLeft: '0.5rem' }}
                  >
                    <option value="auto">Auto-Balance (Recommended)</option>
                    <option value="1">1 Candidate / Slide</option>
                    <option value="2">2 Candidates / Slide</option>
                    <option value="3">3 Candidates / Slide</option>
                    <option value="4">4 Candidates / Slide</option>
                  </select>
                </label>
              )}

              {outputMode !== '7920x1650' && (
                <button className="btn-secondary" onClick={handleAddNewSlide} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', marginRight: '0.5rem' }}>
                  + Add Slide
                </button>
              )}

              <button className="btn-primary" onClick={handleExportSlides} style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                {outputMode === '7920x1650' ? 'Download LED Strip' : 'Download Slides'}
              </button>
            </div>
          </div>

          {/* Slides grid rendering */}
          {slides[activeTab].length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="17" x2="9" y2="8"/>
                <line x1="15" y1="17" x2="15" y2="14"/>
              </svg>
              <h3>No Baptism Slides Created</h3>
              <p>Upload photos to auto-populate baptism slides for this service time.</p>
            </div>
          ) : (
            <div className="slides-grid" style={{ gridTemplateColumns: outputMode === '7920x1650' ? '1fr' : undefined }}>
              {slides[activeTab].map((slide, sIdx) => (
                <div key={slide.id} className="slide-card-wrapper" style={{ width: '100%' }}>
                  <div className="slide-header">
                    <span>{outputMode === '7920x1650' ? 'LED FULLSCREEN STRIP' : `SLIDE ${sIdx + 1}`} ({slide.people.length} People)</span>
                    <div className="actions">
                      {outputMode !== '7920x1650' && (
                        <button
                          className="slide-btn-small delete"
                          onClick={() => handleDeleteSlide(slide.id)}
                          title="Delete Slide"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                  <SlidePreview
                    slide={slide}
                    availablePhotos={photos}
                    onAssignPhoto={handleAssignPhoto}
                    onEditPhoto={handleEditPhoto}
                    templateImageLoaded={templateLoaded}
                    templateImgElement={templateImgEl}
                    outputMode={outputMode}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Popover/Modal for Interactive Cropping */}
      {editingPhoto && editingSlide && (
        <PhotoCropper
          slide={editingSlide}
          personIdx={editingPhoto.personIdx}
          outputMode={outputMode}
          onUpdateCrop={handleUpdateCrop}
          onClose={() => setEditingPhoto(null)}
          templateImgElement={templateImgEl}
        />
      )}

      {/* Toast notifications */}
      {toastMessage && (
        <div className="toast-notification">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
