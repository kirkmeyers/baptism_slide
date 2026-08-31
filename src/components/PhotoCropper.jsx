import React, { useEffect, useRef, useState } from 'react';
import { LAYOUTS } from './SlidePreview';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const TEXT_COLOR = '#003A5D';
const BORDER_COLOR = '#FFFFFF';
const BORDER_THICKNESS = 8;

const toTitleCase = (str) => {
  if (!str) return '';
  return str.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

export default function PhotoCropper({
  slide,
  personIdx,
  onUpdateCrop,
  onClose,
  templateImgElement,
  outputMode = '1920x1080',
  availablePhotos = [],
  onAssignPhoto = () => {},
  enableFamilyGrouping = true
}) {
  const canvasRef = useRef(null);
  const people = slide.people || [];
  
  const isLED = outputMode === '7920x1650';
  const canvasW = isLED ? 7920 : 1920;
  const canvasH = isLED ? 1650 : 1080;

  const getLEDLayout = (peopleList) => {
    const num = peopleList.length;
    if (num === 0) return [];
    
    if (num < 16) {
      // Single Row layout
      let size = 390;
      let gap = 60;
      let totalWidth = num * size + (num - 1) * gap;

      if (totalWidth > 7920) {
        const scale = 7920 / totalWidth;
        size = Math.floor(390 * scale);
        gap = Math.floor(60 * scale);
        totalWidth = num * size + (num - 1) * gap;
      }

      const startX = (7920 - totalWidth) / 2;
      const yStart = 375;
      
      const layoutArray = [];
      for (let i = 0; i < num; i++) {
        const x = startX + i * (size + gap);
        layoutArray.push({ x, y: yStart, size });
      }
      return layoutArray;
    } else {
      // Double Row layout (16 or more people)
      let splitIdx = Math.ceil(num / 2);

      const prevPerson = peopleList[splitIdx - 1];
      const nextPerson = peopleList[splitIdx];
      const prevLast = (prevPerson?.lastName || '').trim().toLowerCase();
      const nextLast = (nextPerson?.lastName || '').trim().toLowerCase();

      if (enableFamilyGrouping && prevLast && nextLast && prevLast === nextLast) {
        // We have a split conflict inside a family! Find start and end of this family block
        let start = splitIdx - 1;
        while (start > 0 && (peopleList[start - 1]?.lastName || '').trim().toLowerCase() === prevLast) {
          start--;
        }

        let end = splitIdx;
        while (end < num && (peopleList[end]?.lastName || '').trim().toLowerCase() === prevLast) {
          end++;
        }

        // Option A: Split at start (family goes to Row 2)
        const offsetA = Math.abs(2 * start - num);

        // Option B: Split at end (family goes to Row 1)
        const offsetB = Math.abs(2 * end - num);

        // Choose the split index that gives the better balance
        if (offsetA <= offsetB) {
          splitIdx = start;
        } else {
          splitIdx = end;
        }

        // Safeguard: if splitting at start/end leaves one row completely empty, fallback to target split
        if (splitIdx === 0 || splitIdx === num) {
          splitIdx = Math.ceil(num / 2);
        }
      }

      const num1 = splitIdx;
      const num2 = num - num1;
      const maxInRow = Math.max(num1, num2);
      
      let size = 390;
      let gap = 60;
      let totalWidth = maxInRow * size + (maxInRow - 1) * gap;

      if (totalWidth > 7920) {
        const scale = 7920 / totalWidth;
        size = Math.floor(390 * scale);
        gap = Math.floor(60 * scale);
      }

      const row1Width = num1 * size + (num1 - 1) * gap;
      const row2Width = num2 * size + (num2 - 1) * gap;
      
      const startX1 = (7920 - row1Width) / 2;
      const startX2 = (7920 - row2Width) / 2;
      
      const layoutArray = [];
      // Row 1 (Top)
      for (let i = 0; i < num1; i++) {
        const x = startX1 + i * (size + gap);
        layoutArray.push({ x, y: 38, size });
      }
      // Row 2 (Bottom)
      for (let i = 0; i < num2; i++) {
        const x = startX2 + i * (size + gap);
        layoutArray.push({ x, y: 640, size });
      }
      return layoutArray;
    }
  };

  const layout = isLED ? getLEDLayout(people) : (LAYOUTS[people.length] || []);

  const getBorderThick = (idx) => {
    const b = layout[idx];
    if (!b) return BORDER_THICKNESS;
    return isLED ? Math.max(8, Math.round(b.size * 0.02)) : BORDER_THICKNESS;
  };

  // Track the active editing person index in local state
  const [activeIdx, setActiveIdx] = useState(personIdx);

  const activeBox = layout[activeIdx];
  const viewportW = isLED ? 800 : 1920;
  const viewportH = isLED ? 800 : 1080;
  const viewportLeft = isLED && activeBox
    ? Math.max(0, Math.min(7120, (activeBox.x + activeBox.size / 2) - 800 / 2))
    : 0;
  const viewportTop = isLED && activeBox
    ? Math.max(0, Math.min(850, (activeBox.y + activeBox.size / 2) - 800 / 2))
    : 0;

  // Get bounds for panning coordinates to prevent showing empty edges
  const getPanLimits = (idx, zoomVal) => {
    const b = layout[idx];
    const p = people[idx];
    if (!b || !p || !p.imageFile) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    const size = b.size;
    const borderThick = getBorderThick(idx);
    const innerSize = size - 2 * borderThick;
    const img = p.imageFile._element;
    if (!img) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

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

    renderW *= zoomVal;
    renderH *= zoomVal;

    const minX = (innerSize - renderW) / 2;
    const maxX = (renderW - innerSize) / 2;
    const minY = (innerSize - renderH) / 2;
    const maxY = (renderH - innerSize) / 2;

    return { minX, maxX, minY, maxY };
  };

  // Store the initial image assignments when the modal is opened
  const [initialPeople] = useState(() => 
    people.map(p => ({
      imageFile: p.imageFile,
      originalImageFile: p.originalImageFile
    }))
  );

  // Store draft crop settings for all people on this slide (clamped on mount)
  const [draftPeople, setDraftPeople] = useState(() => 
    people.map((p, idx) => {
      const initZoom = p.zoom || 1;
      const initPanX = p.panX || 0;
      const initPanY = p.panY || 0;
      
      const b = layout[idx];
      if (b && p.imageFile && p.imageFile._element) {
        const size = b.size;
        const borderThick = getBorderThick(idx);
        const innerSize = size - 2 * borderThick;
        const img = p.imageFile._element;
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
        renderW *= initZoom;
        renderH *= initZoom;
        const minX = (innerSize - renderW) / 2;
        const maxX = (renderW - innerSize) / 2;
        const minY = (innerSize - renderH) / 2;
        const maxY = (renderH - innerSize) / 2;
        return {
          zoom: initZoom,
          panX: Math.max(minX, Math.min(maxX, initPanX)),
          panY: Math.max(minY, Math.min(maxY, initPanY))
        };
      }
      return { zoom: initZoom, panX: initPanX, panY: initPanY };
    })
  );
  
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialPan = useRef({ x: 0, y: 0 });

  const activePerson = people[activeIdx];
  const activeDraft = draftPeople[activeIdx] || { zoom: 1, panX: 0, panY: 0 };
  const limits = getPanLimits(activeIdx, activeDraft.zoom);

  // Sync initialPan when active slot changes
  useEffect(() => {
    if (activeDraft) {
      initialPan.current = { x: activeDraft.panX, y: activeDraft.panY };
    }
  }, [activeIdx]);

  // Update canvas in real-time as draft crops, activeIdx, or template changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeBox) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Clear viewport area
    ctx.clearRect(0, 0, viewportW, viewportH);

    ctx.save();
    ctx.translate(-viewportLeft, -viewportTop);

    // 1. Draw template (Option 1 only: Option 2 is transparent)
    if (!isLED) {
      if (templateImgElement) {
        ctx.drawImage(templateImgElement, 0, 0, canvasW, canvasH);
      } else {
        ctx.fillStyle = '#F4F2EF';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.fillStyle = '#B9D2DC';
        ctx.fillRect(0, 750, canvasW, 330);
      }
    }

    // 2. Draw all people on this slide using their current draft crops
    people.forEach((p, idx) => {
      const b = layout[idx];
      if (!b) return;

      const isCurrent = idx === activeIdx;
      const { x, y, size } = b;
      const borderThick = getBorderThick(idx);
      const innerX = x + borderThick;
      const innerY = y + borderThick;
      const innerSize = size - 2 * borderThick;

      if (p.imageFile) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(innerX, innerY, innerSize, innerSize);
        ctx.clip();

        const img = p.imageFile._element;
        if (img) {
          // Use current local draft crop for rendering
          const crop = draftPeople[idx] || { zoom: 1, panX: 0, panY: 0 };
          const currentZoom = crop.zoom;
          const currentPanX = crop.panX;
          const currentPanY = crop.panY;

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

          renderW *= currentZoom;
          renderH *= currentZoom;

          const renderX = innerX + (innerSize - renderW) / 2 + currentPanX;
          const renderY = innerY + (innerSize - renderH) / 2 + currentPanY;

          ctx.drawImage(img, renderX, renderY, renderW, renderH);
        }
        ctx.restore();
      } else {
        // Placeholder
        ctx.fillStyle = '#E2E8F0';
        ctx.fillRect(innerX, innerY, innerSize, innerSize);
      }

      // Border
      ctx.lineWidth = borderThick;
      ctx.strokeStyle = BORDER_COLOR;
      ctx.strokeRect(x + borderThick / 2, y + borderThick / 2, size - borderThick, size - borderThick);



      // Names
      ctx.textAlign = 'center';
      const textX = x + size / 2;
      ctx.fillStyle = TEXT_COLOR;

      if (isLED) {
        const fontSize = Math.min(55, Math.round(size * 0.165));
        ctx.font = `700 ${fontSize}px Lato, sans-serif`;
        ctx.fillText(toTitleCase(p.firstName), textX, y + size + 75);

        ctx.font = `400 ${fontSize}px Lato, sans-serif`;
        ctx.fillText(toTitleCase(p.lastName), textX, y + size + 140);
      } else {
        ctx.font = '700 60px Lato, sans-serif';
        ctx.fillText(toTitleCase(p.firstName), textX, 910);

        ctx.font = '400 60px Lato, sans-serif';
        ctx.fillText(toTitleCase(p.lastName), textX, 980);
      }

      // Dim other slots to highlight the editing one
      if (!isCurrent) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(x, y, size, size);
      }
    });

    // Draw active glowing frame around editing slot
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#00F2FE';
    ctx.strokeRect(activeBox.x - 3, activeBox.y - 3, activeBox.size + 6, activeBox.size + 6);

    ctx.restore();

  }, [people, activeIdx, draftPeople, templateImgElement, activeBox, isLED, canvasW, canvasH, viewportLeft, viewportTop, viewportW, viewportH]);

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !activeBox) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * viewportW + viewportLeft;
    const clickY = ((e.clientY - rect.top) / rect.height) * viewportH + viewportTop;

    // Check if the user clicked on any OTHER photo slot to switch focus
    let clickedOtherIdx = -1;
    people.forEach((p, idx) => {
      if (idx === activeIdx) return;
      const b = layout[idx];
      if (b && clickX >= b.x && clickX <= b.x + b.size && clickY >= b.y && clickY <= b.y + b.size) {
        if (p.imageFile) {
          clickedOtherIdx = idx;
        }
      }
    });

    if (clickedOtherIdx !== -1) {
      // Switch focus and reset dragging
      setActiveIdx(clickedOtherIdx);
      isDragging.current = false;
      return;
    }

    // Only allow drag if click is inside the active editing box
    if (clickX >= activeBox.x && clickX <= activeBox.x + activeBox.size && clickY >= activeBox.y && clickY <= activeBox.y + activeBox.size) {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      initialPan.current = { x: activeDraft.panX, y: activeDraft.panY };
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current || !activeDraft) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    // Scale canvas movement to match current viewport resolution
    const scaleX = viewportW / rect.width;
    const scaleY = viewportH / rect.height;

    const rawPanX = initialPan.current.x + dx * scaleX;
    const rawPanY = initialPan.current.y + dy * scaleY;

    // Clamp coordinates using active limits
    const { minX, maxX, minY, maxY } = getPanLimits(activeIdx, activeDraft.zoom);
    const newPanX = Math.max(minX, Math.min(maxX, rawPanX));
    const newPanY = Math.max(minY, Math.min(maxY, rawPanY));

    // Update pan coordinates in local drafts list
    setDraftPeople(prev => 
      prev.map((item, idx) => idx === activeIdx ? { ...item, panX: newPanX, panY: newPanY } : item)
    );
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleSwapSilhouette = (filename) => {
    const activePerson = people[activeIdx];
    if (!activePerson) return;

    const isCurrentSilhouette = activePerson.imageFile?.name === filename;

    if (isCurrentSilhouette) {
      // Toggle off: Revert to original photo
      const originalPhoto = activePerson.originalImageFile;
      if (originalPhoto) {
        onAssignPhoto(slide.id, activeIdx, originalPhoto);
        const savedPhoto = availablePhotos.find(p => p.name === originalPhoto.name) || originalPhoto;
        setDraftPeople((prev) =>
          prev.map((item, idx) => (idx === activeIdx ? { 
            zoom: savedPhoto.zoom || 1.0, 
            panX: savedPhoto.panX || 0, 
            panY: savedPhoto.panY || 0 
          } : item))
        );
      } else {
        // Clear assignment if there was no original photo
        onAssignPhoto(slide.id, activeIdx, null);
        setDraftPeople((prev) =>
          prev.map((item, idx) => (idx === activeIdx ? { zoom: 1.0, panX: 0, panY: 0 } : item))
        );
      }
    } else {
      // Toggle on: Assign silhouette
      const photoObj = availablePhotos.find((p) => p.name === filename);
      if (photoObj) {
        onAssignPhoto(slide.id, activeIdx, photoObj);
        setDraftPeople((prev) =>
          prev.map((item, idx) => (idx === activeIdx ? { zoom: 1.0, panX: 0, panY: 0 } : item))
        );
      }
    }
  };

  const handleCancel = () => {
    // Revert parent assignments back to their initial state on cancel
    initialPeople.forEach((p, idx) => {
      onAssignPhoto(slide.id, idx, p.imageFile);
    });
    onClose();
  };

  const handleSave = () => {
    onUpdateCrop(slide.id, draftPeople);
    onClose();
  };

  return (
    <div className="modal-overlay" onMouseUp={handleMouseUp}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isLED ? '750px' : '960px' }}>
        <button className="modal-close-btn" onClick={onClose}>&times;</button>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          Adjust Crop & Positioning: {activePerson?.fullName}
        </h2>

        <div className="cropper-container">
          {/* Visual Workspace Canvas */}
          <div className="cropper-canvas-wrapper" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} style={{ aspectRatio: `${viewportW}/${viewportH}`, background: isLED ? '#FFFFFF' : '#111827' }}>
            <canvas ref={canvasRef} width={viewportW} height={viewportH} />
            <div className="cropper-drag-hint">
              <span style={{ color: 'var(--accent-teal)', fontWeight: 'bold' }}>Drag on the photo</span> to pan • <span style={{ color: 'var(--accent-teal)', fontWeight: 'bold' }}>Click other photos</span> to switch focus
            </div>
          </div>

          {/* Sider Controls */}
          <div className="cropper-controls">
            <div className="cropper-settings-group">
              <div>
                <label className="control-label">
                  <span>Zoom Scale</span>
                  <span className="value">{Math.round(activeDraft.zoom * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.05"
                  value={activeDraft.zoom}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setDraftPeople(prev => 
                      prev.map((item, idx) => {
                        if (idx !== activeIdx) return item;
                        // Re-clamp panning offset for this new zoom level
                        const { minX, maxX, minY, maxY } = getPanLimits(idx, val);
                        const clampedX = Math.max(minX, Math.min(maxX, item.panX));
                        const clampedY = Math.max(minY, Math.min(maxY, item.panY));
                        return { ...item, zoom: val, panX: clampedX, panY: clampedY };
                      })
                    );
                  }}
                  className="range-input"
                  style={{ marginTop: '0.5rem' }}
                />
              </div>

              <div>
                <label className="control-label">
                  <span>Horizontal Pan</span>
                  <span className="value">{Math.round(activeDraft.panX)}px</span>
                </label>
                <input
                  type="range"
                  min={limits.minX}
                  max={limits.maxX}
                  step="1"
                  value={activeDraft.panX}
                  disabled={limits.minX === limits.maxX}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setDraftPeople(prev => prev.map((item, idx) => idx === activeIdx ? { ...item, panX: val } : item));
                  }}
                  className="range-input"
                  style={{ marginTop: '0.5rem' }}
                />
              </div>

              <div>
                <label className="control-label">
                  <span>Vertical Pan</span>
                  <span className="value">{Math.round(activeDraft.panY)}px</span>
                </label>
                <input
                  type="range"
                  min={limits.minY}
                  max={limits.maxY}
                  step="1"
                  value={activeDraft.panY}
                  disabled={limits.minY === limits.maxY}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setDraftPeople(prev => prev.map((item, idx) => idx === activeIdx ? { ...item, panY: val } : item));
                  }}
                  className="range-input"
                  style={{ marginTop: '0.5rem' }}
                />
              </div>

              <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem' }}>
                <span className="control-label" style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Quick Silhouette Swap:
                </span>
                {(() => {
                  const activePerson = people[activeIdx];
                  const isFemaleActive = activePerson?.imageFile?.name === 'silhouette_female.png';
                  const isMaleActive = activePerson?.imageFile?.name === 'silhouette_male.png';
                  return (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        className={isFemaleActive ? "btn-primary" : "btn-secondary"}
                        style={{
                          flex: 1,
                          padding: '0.4rem 0.5rem',
                          fontSize: '0.72rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.25rem',
                          border: isFemaleActive ? '1px solid var(--accent-teal)' : undefined,
                          background: isFemaleActive ? 'rgba(0, 242, 254, 0.2)' : undefined,
                          color: isFemaleActive ? '#FFFFFF' : undefined
                        }}
                        onClick={() => handleSwapSilhouette('silhouette_female.png')}
                      >
                        👩 Female
                      </button>
                      <button
                        className={isMaleActive ? "btn-primary" : "btn-secondary"}
                        style={{
                          flex: 1,
                          padding: '0.4rem 0.5rem',
                          fontSize: '0.72rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.25rem',
                          border: isMaleActive ? '1px solid var(--accent-teal)' : undefined,
                          background: isMaleActive ? 'rgba(0, 242, 254, 0.2)' : undefined,
                          color: isMaleActive ? '#FFFFFF' : undefined
                        }}
                        onClick={() => handleSwapSilhouette('silhouette_male.png')}
                      >
                        👨 Male
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div className="cropper-help-box">
                <strong>Tips:</strong>
                <ul>
                  <li>Click directly on any photo in the template preview to start editing it.</li>
                  <li>Drag the photo inside the glowing box frame to center faces.</li>
                  <li>Photos are constrained so their edges never slide past the white border.</li>
                  <li>Click Apply to save all adjustments made to this slide.</li>
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn-secondary" onClick={handleCancel} style={{ flex: 1 }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSave} style={{ flex: 1.5 }}>
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
