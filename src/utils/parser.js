/**
 * Parses user input (HTML or plain text) from the Rock database baptism page.
 * Extracts names, service times, and image URLs.
 */
export function parseRockInput(input) {
  if (!input || !input.trim()) return [];

  // Try parsing as HTML first
  const isHtml = /<[a-z][\s\S]*>/i.test(input);
  if (isHtml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(input, 'text/html');
      const candidates = [];

      // Look for common Rock list patterns, e.g., rows, cards, or tables
      // Often, names are in links or strong tags, images in img tags, services in headers or labels
      
      // Let's traverse the DOM and extract people
      // We can also search for all images and find their nearest name and service context.
      const images = doc.querySelectorAll('img');
      
      if (images.length > 0) {
        images.forEach((img) => {
          const src = img.getAttribute('src') || '';
          // We look for Rock Image handler or any image path that looks like a photo
          if (src.includes('GetImage.ashx') || src.includes('/GetImage') || src.match(/\.(jpeg|jpg|gif|png)/i)) {
            // Find parent row or container to find name and service
            let parent = img.parentElement;
            let containerText = '';
            let serviceTime = '9:00 AM'; // Default fallback
            
            // Search up to 5 levels to find text content
            for (let i = 0; i < 5 && parent; i++) {
              containerText += ' ' + parent.textContent;
              
              // Check if we can find a service time in this container
              const serviceMatch = parent.textContent.match(/(9:00\s*AM|11:15\s*AM|4:00\s*PM|9\s*am|11:15\s*am|4\s*pm|9:00|11:15|4:00|4)/i);
              if (serviceMatch) {
                serviceTime = normalizeServiceTime(serviceMatch[0]);
              }
              
              parent = parent.parentElement;
            }

            // Extract Name from the alt attribute, or title, or the text around it
            let fullName = img.getAttribute('alt') || img.getAttribute('title') || '';
            fullName = fullName.replace(/photo|avatar|profile/gi, '').trim();

            if (!fullName) {
              // Try to find the first 2-3 capitalized words in the container text
              // Excluding keywords like "Service", "Baptism", etc.
              const cleanText = containerText
                .replace(/[\r\n\t]+/g, ' ')
                .replace(/9:00|11:15|4:00|am|pm|service|baptism|rock|watermark/gi, '')
                .trim();
              
              const words = cleanText.match(/[A-Z][a-z]+/g) || [];
              if (words.length >= 2) {
                fullName = `${words[0]} ${words[1]}`;
              }
            }

            // Clean up the name
            fullName = cleanName(fullName);

            if (fullName) {
              // Get the absolute/relative image path
              let fullSrc = src;
              if (src.startsWith('/')) {
                fullSrc = 'https://rock.watermark.org' + src;
              }
              
              candidates.push({
                id: Math.random().toString(36).substr(2, 9),
                fullName,
                firstName: getFirstName(fullName),
                lastName: getLastName(fullName),
                serviceTime,
                imageUrl: fullSrc,
                imageFile: null, // to be matched later
                cropX: 0,
                cropY: 0,
                zoom: 1
              });
            }
          }
        });
      }

      // If we found candidates in DOM, return them
      if (candidates.length > 0) {
        // Filter duplicates by name + service
        return filterDuplicates(candidates);
      }
    } catch (e) {
      console.error('Failed to parse as HTML, falling back to text parsing', e);
    }
  }

  // Fallback to text parsing (line-by-line regex)
  return parseTextLines(input);
}

function normalizeServiceTime(timeStr) {
  const clean = timeStr.toLowerCase().replace(/\s+/g, '');
  if (clean.includes('9:00') || clean.includes('9am') || clean === '9') {
    return '9:00 AM';
  }
  if (clean.includes('11:15') || clean.includes('1115') || clean.includes('11:15am') || clean === '11') {
    return '11:15 AM';
  }
  if (clean.includes('4:00') || clean.includes('4pm') || clean === '4') {
    return '4:00 PM';
  }
  return '9:00 AM'; // Default fallback
}

function cleanName(name) {
  return name
    .replace(/[^a-zA-Z\s\-]/g, '') // Keep letters, spaces, hyphens
    .replace(/\s+/g, ' ')
    .trim();
}

function getFirstName(fullName) {
  const parts = fullName.split(' ');
  return parts[0] || '';
}

function getLastName(fullName) {
  const parts = fullName.split(' ');
  return parts.slice(1).join(' ') || '';
}

function filterDuplicates(candidates) {
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${c.fullName.toLowerCase()}_${c.serviceTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTextLines(text) {
  const lines = text.split('\n');
  const candidates = [];
  
  // Track current service if headings are used
  let currentService = '9:00 AM';

  lines.forEach((line) => {
    const cleanLine = line.trim();
    if (!cleanLine) return;

    // Check if line is a service header
    if (/(9:00\s*AM|9\s*am|9am|9\s*service)/i.test(cleanLine)) {
      currentService = '9:00 AM';
      return;
    }
    if (/(11:15\s*AM|1115\s*am|11:15am|11:15|11:15\s*service)/i.test(cleanLine)) {
      currentService = '11:15 AM';
      return;
    }
    if (/(4:00\s*PM|4\s*pm|4pm|4\s*service)/i.test(cleanLine)) {
      currentService = '4:00 PM';
      return;
    }

    // Try to extract name and check if it contains a service time inline
    let serviceTime = currentService;
    const inlineServiceMatch = cleanLine.match(/(9:00\s*AM|11:15\s*AM|4:00\s*PM|9\s*am|11:15\s*am|4\s*pm|9:00|11:15|4:00|4)/i);
    if (inlineServiceMatch) {
      serviceTime = normalizeServiceTime(inlineServiceMatch[0]);
    }

    // Remove service indicator and other noise to get the name
    let possibleName = cleanLine
      .replace(/(9:00\s*AM|11:15\s*AM|4:00\s*PM|9\s*am|11:15\s*am|4\s*pm|9:00|11:15|4:00|4|am|pm|service|baptism)/gi, '')
      .replace(/[-\d]/g, '') // remove dashes and numbers
      .trim();

    possibleName = cleanName(possibleName);
    
    // Check if we have at least first and last name (two words)
    const words = possibleName.split(' ');
    if (words.length >= 2) {
      candidates.push({
        id: Math.random().toString(36).substr(2, 9),
        fullName: possibleName,
        firstName: words[0],
        lastName: words.slice(1).join(' '),
        serviceTime,
        imageUrl: '',
        imageFile: null,
        cropX: 0,
        cropY: 0,
        zoom: 1
      });
    }
  });

  return filterDuplicates(candidates);
}
