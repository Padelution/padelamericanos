require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Configuration, OpenAIApi } = require('openai');

// Configure OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Supported languages configuration
const LANGUAGES = {
  fi: 'Finnish',
  sv: 'Swedish',
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ar: 'Arabic',
  cs: 'Czech',
  da: 'Danish',
  el: 'Greek',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  ms: 'Malay',
  no: 'Norwegian',
  ro: 'Romanian',
  sk: 'Slovak',
  th: 'Thai',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  bg: 'Bulgarian',
  hr: 'Croatian',
  lt: 'Lithuanian',
  sl: 'Slovenian',
  sr: 'Serbian',
  ca: 'Catalan',
  et: 'Estonian',
  lv: 'Latvian',
  fa: 'Persian',
  sw: 'Swahili',
  tl: 'Filipino'
};

// Cache file path for storing content hashes
const CACHE_FILE = path.join(__dirname, '../.translation-cache.json');

async function loadCache() {
  try {
    const cache = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(cache);
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function calculateHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function translateContent(content, targetLang) {
  console.log(`Starting translation to ${targetLang}`);
  console.log('Content length:', content.length);
  
  // Get the language code for the target language
  const langCode = Object.entries(LANGUAGES).find(([code, name]) => name === targetLang)?.[0];
  
  // Add language prefix to markdown links using the language code
  const contentWithUpdatedLinks = content.replace(
    /\[([^\]]+)\]\(\/([^)]+)\)/g,
    (match, text, url) => `[${text}](/${langCode}/${url.replace(/^\//, '')})`
  );
  
  try {
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a professional translator specializing in markdown content. Instructions:
                   1. Translate the following content to ${targetLang}
                   2. Preserve all markdown formatting exactly (##, -, *, etc.)
                   3. Keep YAML frontmatter unchanged
                   4. Keep HTML tags unchanged
                   5. Maintain the same line breaks and spacing
                   6. Only translate human-readable text
                   7. Do not modify URLs in markdown links`
        },
        {
          role: "user",
          content: contentWithUpdatedLinks
        }
      ],
      temperature: 0.3,
      presence_penalty: 0,
      frequency_penalty: 0
    });

    console.log('OpenAI API response received');
    if (!response.data.choices[0]?.message?.content) {
      console.error('Unexpected API response structure:', JSON.stringify(response.data));
      throw new Error('Invalid API response');
    }

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(`Translation error for ${targetLang}:`, error.message);
    if (error.response) {
      console.error('API Error details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    throw error;
  }
}

async function processFile(filePath) {
  console.log(`\nProcessing file: ${filePath}`);
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    console.log(`File content length: ${content.length} characters`);
    
    const contentHash = calculateHash(content);
    const cache = await loadCache();
    const fileCache = cache[filePath] || {};
  
    for (const [langCode, langName] of Object.entries(LANGUAGES)) {
      const langFilePath = filePath.replace(
        /(.+)\/([^/]+)\.md$/,
        `$1/$2.${langCode}.md`
      );
      console.log(`\nProcessing language: ${langName} (${langCode})`);
      console.log(`Target file: ${langFilePath}`);

      try {
        const translatedContent = await translateContent(content, langName);
        console.log(`Translation completed, content length: ${translatedContent.length}`);
        
        await fs.writeFile(langFilePath, translatedContent);
        console.log(`File written successfully: ${langFilePath}`);
      } catch (error) {
        console.error(`Failed to translate ${filePath} to ${langCode}:`, error);
      }
    }

    // Update cache with new hash after successful translation
    fileCache.contentHash = contentHash;
    cache[filePath] = fileCache;
    await saveCache(cache);
    console.log('Cache saved successfully');
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

async function findMarkdownFiles(dir) {
  console.log(`Scanning directory: ${dir}`);
  const files = await fs.readdir(dir, { withFileTypes: true });
  const markdownFiles = [];

  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      console.log(`Found directory: ${fullPath}`);
      markdownFiles.push(...await findMarkdownFiles(fullPath));
    } else if (
      file.isFile() && 
      file.name.endsWith('.md') && 
      // Only include default language files (not *.fr.md, *.ja.md, etc)
      !Object.keys(LANGUAGES).some(lang => file.name.includes(`.${lang}.`))
    ) {
      console.log(`Found markdown file: ${fullPath}`);
      markdownFiles.push(fullPath);
    } else {
      console.log(`Skipping file: ${fullPath}`);
    }
  }

  return markdownFiles;
}

async function main() {
  console.log('Starting translation process...');
  console.log('OpenAI API Key present:', !!process.env.OPENAI_API_KEY);
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  try {
    const contentDir = path.join(__dirname, '../content');
    console.log(`Scanning content directory: ${contentDir}`);
    
    const markdownFiles = await findMarkdownFiles(contentDir);
    console.log(`Found ${markdownFiles.length} markdown files:`, markdownFiles);

    // Load cache once
    const cache = await loadCache();
    
    // Filter files that have changed
    const changedFiles = [];
    for (const filePath of markdownFiles) {
      const content = await fs.readFile(filePath, 'utf8');
      const contentHash = calculateHash(content);
      const fileCache = cache[filePath] || {};
      
      if (fileCache.contentHash !== contentHash) {
        console.log(`File changed: ${filePath}`);
        changedFiles.push(filePath);
      } else {
        console.log(`File unchanged, skipping: ${filePath}`);
      }
    }

    console.log(`Found ${changedFiles.length} changed files to process:`, changedFiles);

    // Only process changed files
    for (const file of changedFiles) {
      await processFile(file);
    }

    console.log('Translation complete!');
  } catch (error) {
    console.error('Translation failed:', error);
    process.exit(1);
  }
}

main(); 