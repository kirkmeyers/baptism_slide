import React, { useEffect, useRef, useState } from 'react';

// Design constants (1920x1080 canvas)
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const TEXT_COLOR = '#003A5D';
const BORDER_COLOR = '#FFFFFF';
const BORDER_THICKNESS = 8;

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
  templateImgElement
}) {
  const canvasRef = useRef(null);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const dropdownRef = useRef(null);

  const people = slide.people || [];
  const N = people.length;
  const layout = LAYOUTS[N] || [];

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
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. Draw background template
    if (templateImageLoaded && templateImgElement) {
      ctx.drawImage(templateImgElement, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      // Fallback background if template not loaded yet
      ctx.fillStyle = '#F4F2EF';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#B9D2DC';
      ctx.fillRect(0, 750, CANVAS_WIDTH, 330);
    }

    // 2. Draw each person (photo + border + names)
    people.forEach((person, idx) => {
      const box = layout[idx];
      if (!box) return;

      const { x, y, size } = box;

      // Draw photo if available
      if (person.imageFile) {
        ctx.save();
        
        // Define clipping path for the photo (inside the border)
        const innerX = x + BORDER_THICKNESS;
        const innerY = y + BORDER_THICKNESS;
        const innerSize = size - 2 * BORDER_THICKNESS;

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
        const innerX = x + BORDER_THICKNESS;
        const innerY = y + BORDER_THICKNESS;
        const innerSize = size - 2 * BORDER_THICKNESS;
        ctx.fillStyle = '#E2E8F0';
        ctx.fillRect(innerX, innerY, innerSize, innerSize);
      }

      // Draw white border
      ctx.lineWidth = BORDER_THICKNESS;
      ctx.strokeStyle = BORDER_COLOR;
      ctx.strokeRect(x + BORDER_THICKNESS / 2, y + BORDER_THICKNESS / 2, size - BORDER_THICKNESS, size - BORDER_THICKNESS);

      // Draw name text
      ctx.textAlign = 'center';
      const textX = x + size / 2;

      // Draw First Name (Lato Bold)
      ctx.font = '700 60px Lato, sans-serif';
      ctx.fillStyle = TEXT_COLOR;
      // Adjust spacing depending on how many people are in the slide
      const firstNameY = 910;
      ctx.fillText((person.firstName || '').toUpperCase(), textX, firstNameY);

      // Draw Last Name (Lato Light)
      ctx.font = '300 60px Lato, sans-serif';
      const lastNameY = 980;
      ctx.fillText(person.lastName || '', textX, lastNameY);
    });

  }, [people, layout, templateImageLoaded, templateImgElement]);

  // Click handler on canvas opens cropper if photo exists
  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const clickY = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;

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
      <div className="slide-canvas-container" onClick={handleCanvasClick}>
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
        
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
          const leftPct = (box.x / CANVAS_WIDTH) * 100;
          const topPct = (box.y / CANVAS_HEIGHT) * 100;
          const sizePct = (box.size / CANVAS_WIDTH) * 100;
          // height pct uses width scaling because canvas ratio is 16:9 (w is 1920, h is 1080)
          const heightPct = (box.size / CANVAS_HEIGHT) * 100;

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
                          {photo.name}
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
