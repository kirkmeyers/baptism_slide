import React, { useEffect, useRef, useState } from 'react';
import { LAYOUTS } from './SlidePreview';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const TEXT_COLOR = '#003A5D';
const BORDER_COLOR = '#FFFFFF';
const BORDER_THICKNESS = 8;

export default function PhotoCropper({
  slide,
  personIdx,
  onUpdateCrop,
  onClose,
  templateImgElement
}) {
  const canvasRef = useRef(null);
  const people = slide.people || [];
  const layout = LAYOUTS[people.length] || [];

  // Track the active editing person index in local state
  const [activeIdx, setActiveIdx] = useState(personIdx);

  // Get bounds for panning coordinates to prevent showing empty edges
  const getPanLimits = (idx, zoomVal) => {
    const b = layout[idx];
    const p = people[idx];
    if (!b || !p || !p.imageFile) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    const size = b.size;
    const innerSize = size - 2 * BORDER_THICKNESS;
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

  // Store draft crop settings for all people on this slide (clamped on mount)
  const [draftPeople, setDraftPeople] = useState(() => 
    people.map((p, idx) => {
      const initZoom = p.zoom || 1;
      const initPanX = p.panX || 0;
      const initPanY = p.panY || 0;
      
      const b = layout[idx];
      if (b && p.imageFile && p.imageFile._element) {
        const size = b.size;
        const innerSize = size - 2 * BORDER_THICKNESS;
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
  const activeBox = layout[activeIdx];
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

    // Clear
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. Draw template
    if (templateImgElement) {
      ctx.drawImage(templateImgElement, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      ctx.fillStyle = '#F4F2EF';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#B9D2DC';
      ctx.fillRect(0, 750, CANVAS_WIDTH, 330);
    }

    // 2. Draw all people on this slide using their current draft crops
    people.forEach((p, idx) => {
      const b = layout[idx];
      if (!b) return;

      const isCurrent = idx === activeIdx;
      const { x, y, size } = b;
      const innerX = x + BORDER_THICKNESS;
      const innerY = y + BORDER_THICKNESS;
      const innerSize = size - 2 * BORDER_THICKNESS;

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
      ctx.lineWidth = BORDER_THICKNESS;
      ctx.strokeStyle = BORDER_COLOR;
      ctx.strokeRect(x + BORDER_THICKNESS / 2, y + BORDER_THICKNESS / 2, size - BORDER_THICKNESS, size - BORDER_THICKNESS);

      // Names
      ctx.textAlign = 'center';
      const textX = x + size / 2;
      ctx.fillStyle = TEXT_COLOR;

      ctx.font = '700 60px Lato, sans-serif';
      ctx.fillText((p.firstName || '').toUpperCase(), textX, 910);

      ctx.font = '300 60px Lato, sans-serif';
      ctx.fillText(p.lastName || '', textX, 980);

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

  }, [people, activeIdx, draftPeople, templateImgElement, activeBox]);

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !activeBox) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const clickY = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;

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

    // Scale canvas movement to match 1920x1080 resolution
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

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

  const handleSave = () => {
    onUpdateCrop(slide.id, draftPeople);
    onClose();
  };

  return (
    <div className="modal-overlay" onMouseUp={handleMouseUp}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>&times;</button>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          Adjust Crop & Positioning: {activePerson?.fullName}
        </h2>

        <div className="cropper-container">
          {/* Visual Workspace Canvas */}
          <div className="cropper-canvas-wrapper" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}>
            <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
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
              <button className="btn-secondary" onClick={onClose} style={{ flex: 1 }}>
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
