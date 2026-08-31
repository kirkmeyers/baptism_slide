import React, { useEffect, useRef, useState } from 'react';

// Design constants (1920x1080 canvas)
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const TEXT_COLOR = '#003A5D';
const BORDER_COLOR = '#FFFFFF';
const BORDER_THICKNESS = 8;

const toTitleCase = (str) => {
  if (!str) return '';
  return str.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

// Layout definitions for 1920x1080
export const LAYOUTS = {
  1: [
    { x: 656, y: 100, size: 608 }
  ],
  2: [
    { x: 316, y: 184, size: 532 },
    { x: 1072, y: 184, size: 532 }
  ],
  3: [
    { x: 146, y: 206, size: 468 },
    { x: 726, y: 206, size: 468 },
    { x: 1306, y: 206, size: 468 }
  ],
  4: [
    { x: 60, y: 246, size: 405 },
    { x: 525, y: 246, size: 405 },
    { x: 990, y: 246, size: 405 },
    { x: 1455, y: 246, size: 405 }
  ]
};

export default function SlidePreview({
  slide,
  availablePhotos,
  onAssignPhoto,
  onEditPhoto,
  templateImageLoaded,
  templateImgElement,
  outputMode = '1920x1080'
}) {
  const canvasRef = useRef(null);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const dropdownRef = useRef(null);

  const people = slide.people || [];
  const N = people.length;
  
  const isLED = outputMode === '7920x1650';
  const canvasW = isLED ? 7920 : 1920;
  const canvasH = isLED ? 1650 : 1080;

  const getLEDLayout = (num) => {
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
      const num1 = Math.ceil(num / 2);
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

  const layout = isLED ? getLEDLayout(N) : (LAYOUTS[N] || []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Redraw canvas whenever people data, images, or template changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Clear canvas
    ctx.clearRect(0, 0, canvasW, canvasH);

    // 1. Draw background template (Option 1 only: Option 2 is transparent)
    if (!isLED) {
      if (templateImageLoaded && templateImgElement) {
        ctx.drawImage(templateImgElement, 0, 0, canvasW, canvasH);
      } else {
        // Fallback background if template not loaded yet
        ctx.fillStyle = '#F4F2EF';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.fillStyle = '#B9D2DC';
        ctx.fillRect(0, 750, canvasW, 330);
      }
    }

    // 2. Draw each person (photo + border + names)
    people.forEach((person, idx) => {
      const box = layout[idx];
      if (!box) return;

      const { x, y, size } = box;
      const borderThick = isLED ? Math.max(8, Math.round(size * 0.02)) : BORDER_THICKNESS;
      const innerX = x + borderThick;
      const innerY = y + borderThick;
      const innerSize = size - 2 * borderThick;

      // Draw photo if available
      if (person.imageFile) {
        ctx.save();
        
        // Define clipping path for the photo (inside the border)
        ctx.beginPath();
        ctx.rect(innerX, innerY, innerSize, innerSize);
        ctx.clip();

        const img = person.imageFile._element; // cache DOM Image element in State
        if (img) {
          // Calculate cropping dimensions with zoom and pan
          const zoom = person.zoom || 1;
          const panX = person.panX || 0;
          const panY = person.panY || 0;

          const imgW = img.width;
          const imgH = img.height;

          // Base sizing to fit the frame (cover)
          let renderW, renderH;
          if (imgW < imgH) {
            renderW = innerSize;
            renderH = imgH * (innerSize / imgW);
          } else {
            renderH = innerSize;
            renderW = imgW * (innerSize / imgH);
          }

          // Apply zoom
          renderW *= zoom;
          renderH *= zoom;

          // Centered coordinates + user drag offset (pan)
          const renderX = innerX + (innerSize - renderW) / 2 + panX;
          const renderY = innerY + (innerSize - renderH) / 2 + panY;

          ctx.drawImage(img, renderX, renderY, renderW, renderH);
        } else {
          // Fallback placeholder color
          ctx.fillStyle = '#E2E8F0';
          ctx.fillRect(innerX, innerY, innerSize, innerSize);
        }
        ctx.restore();
      } else {
        // Unassigned placeholder - drawn on canvas (behind HTML overlays)
        ctx.fillStyle = '#E2E8F0';
        ctx.fillRect(innerX, innerY, innerSize, innerSize);
      }

      // Draw white border
      ctx.lineWidth = borderThick;
      ctx.strokeStyle = BORDER_COLOR;
      ctx.strokeRect(x + borderThick / 2, y + borderThick / 2, size - borderThick, size - borderThick);



      // Draw name text
      ctx.textAlign = 'center';
      const textX = x + size / 2;
      ctx.fillStyle = TEXT_COLOR;

      if (isLED) {
        const fontSize = Math.min(55, Math.round(size * 0.165));
        ctx.font = `700 ${fontSize}px Lato, sans-serif`;
        ctx.fillText(toTitleCase(person.firstName), textX, y + size + 75);

        ctx.font = `400 ${fontSize}px Lato, sans-serif`;
        ctx.fillText(toTitleCase(person.lastName), textX, y + size + 140);
      } else {
        // Draw First Name (Lato Bold)
        ctx.font = '700 60px Lato, sans-serif';
        ctx.fillText(toTitleCase(person.firstName), textX, 910);

        // Draw Last Name (Lato Regular)
        ctx.font = '400 60px Lato, sans-serif';
        ctx.fillText(toTitleCase(person.lastName), textX, 980);
      }
    });

  }, [people, layout, templateImageLoaded, templateImgElement, isLED, canvasW, canvasH]);

  // Click handler on canvas opens cropper if photo exists
  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * canvasW;
    const clickY = ((e.clientY - rect.top) / rect.height) * canvasH;

    // Check which person slot was clicked
    people.forEach((person, idx) => {
      const box = layout[idx];
      if (!box) return;
      
      const { x, y, size } = box;
      if (clickX >= x && clickX <= x + size && clickY >= y && clickY <= y + size) {
        if (person.imageFile) {
          onEditPhoto(slide.id, idx);
        } else {
          // Toggle photo assignment dropdown
          setActiveDropdown(activeDropdown === idx ? null : idx);
        }
      }
    });
  };

  return (
    <div className="slide-card">
      <div className="slide-canvas-container" onClick={handleCanvasClick} style={{ aspectRatio: isLED ? '7920/1650' : '16/9', background: isLED ? '#FFFFFF' : '#1e293b' }}>
        <canvas ref={canvasRef} width={canvasW} height={canvasH} />
        
        {/* Overlay showing 'Click to Crop / Adjust' if photos are assigned */}
        {people.some(p => p.imageFile) && (
          <div className="edit-overlay-hint">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <span>Click Photo to Crop / Scale</span>
          </div>
        )}

        {/* HTML overlays for unassigned photo slots (clickable/droppable) */}
        {people.map((person, idx) => {
          if (person.imageFile) return null;
          const box = layout[idx];
          if (!box) return null;

          // Convert coordinates to percentages for CSS positioning
          const leftPct = (box.x / canvasW) * 100;
          const topPct = (box.y / canvasH) * 100;
          const sizePct = (box.size / canvasW) * 100;
          const heightPct = (box.size / canvasH) * 100;

          return (
            <div
              key={idx}
              className="unassigned-photo-slot"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${sizePct}%`,
                height: `${heightPct}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setActiveDropdown(activeDropdown === idx ? null : idx);
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="slot-label">{person.fullName}</span>
              <span className="slot-sub">Click to match photo</span>

              {/* Photo selector dropdown */}
              {activeDropdown === idx && (
                <div ref={dropdownRef} className="assignment-dropdown" onClick={e => e.stopPropagation()}>
                  <div style={{ padding: '0.4rem', fontSize: '0.7rem', borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                    Choose Photo:
                  </div>
                  {availablePhotos.length === 0 ? (
                    <div style={{ padding: '0.5rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      No photos uploaded. Upload folders on the left panel!
                    </div>
                  ) : (
                    availablePhotos.map((photo) => (
                      <div
                        key={photo.name}
                        className="assignment-option"
                        onClick={() => {
                          onAssignPhoto(slide.id, idx, photo);
                          setActiveDropdown(null);
                        }}
                      >
                        <img src={photo.url} alt={photo.name} />
                        <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {photo.name === 'silhouette_female.png' ? '👤 Silhouette (Female)' : 
                           photo.name === 'silhouette_male.png' ? '👤 Silhouette (Male)' : 
                           photo.name}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
