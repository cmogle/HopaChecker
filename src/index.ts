#!/usr/bin/env node
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import { monitor, checkSiteStatus, formatStatusMessage, loadState } from './monitor.js';
import { scrapeAllResults, scrapeEvoChipResults, saveResults, loadResults, getResultsFilePath } from './scraper.js';
import { searchFromFile, searchByName, formatSearchResults } from './search.js';
import { sendNotification, isTwilioConfigured } from './notifications/index.js';
import type { Config } from './types.js';

// Load environment variables
dotenv.config();

const DEFAULT_URL = 'https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026';

function getConfig(): Config {
  return {
    targetUrl: process.env.TARGET_URL || DEFAULT_URL,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '300000', 10),
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
    },
    notifyWhatsapp: process.env.NOTIFY_WHATSAPP || '',
  };
}

const program = new Command();

program
  .name('hopachecker')
  .description('Monitor and scrape Dubai Creek Striders Half Marathon results')
  .version('2.0.0');

// Status command
program
  .command('status')
  .description('Check current status of the results page')
  .action(async () => {
    const config = getConfig();
    console.log(`\n🔍 Checking status of: ${config.targetUrl}\n`);

    const status = await checkSiteStatus(config.targetUrl);

    if (status.isUp) {
      console.log(`✅ Site is UP`);
      console.log(`   Status Code: ${status.statusCode}`);
      console.log(`   Response Time: ${status.responseTime}ms`);
      console.log(`   Results Available: ${status.hasResults ? 'Likely yes' : 'Unknown'}`);
    } else {
      console.log(`❌ Site is DOWN`);
      console.log(`   Status Code: ${status.statusCode || 'N/A'}`);
      console.log(`   Error: ${status.error || 'HTTP error'}`);
    }

    const state = await loadState();
    console.log(`\n📊 Monitor State:`);
    console.log(`   Last Status: ${state.lastStatus}`);
    console.log(`   Last Checked: ${new Date(state.lastChecked).toLocaleString()}`);
    console.log(`   Last Change: ${new Date(state.lastStatusChange).toLocaleString()}`);
  });

// Monitor command (single check - for cron jobs)
program
  .command('monitor')
  .description('Run a single monitor check (for cron jobs)')
  .option('--notify', 'Send notification if status changed')
  .option('--continuous', 'Run continuously with polling')
  .option('--auto-scrape', 'Automatically scrape results when site comes back up')
  .action(async (options) => {
    const config = getConfig();
    console.log(`\n🔍 Monitoring: ${config.targetUrl}`);

    const performAutoScrape = async (): Promise<string> => {
      console.log('\n📥 Auto-scraping results...');
      try {
        const data = await scrapeAllResults(config.targetUrl);
        await saveResults(data);
        const total = data.categories.halfMarathon.length + data.categories.tenKm.length;
        console.log(`✅ Scraped ${total} results`);
        return `\n\n📊 Auto-scraped ${total} results (${data.categories.halfMarathon.length} HM, ${data.categories.tenKm.length} 10K)`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`⚠️  Auto-scrape failed: ${errorMessage}`);
        return `\n\n⚠️ Auto-scrape failed: ${errorMessage}`;
      }
    };

    if (options.continuous) {
      // Continuous monitoring mode
      console.log(`⏰ Polling every ${config.pollIntervalMs / 1000} seconds`);
      if (options.autoScrape) console.log('🔄 Auto-scrape enabled');
      console.log('   Press Ctrl+C to stop\n');

      const runCheck = async () => {
        const result = await monitor(config.targetUrl);
        let message = formatStatusMessage(result, config.targetUrl);
        console.log(`[${new Date().toLocaleTimeString()}] ${result.currentStatus.isUp ? '✅' : '❌'} ${result.currentStatus.statusCode || 'Error'}`);

        if (result.wentUp) {
          // Auto-scrape if enabled
          if (options.autoScrape) {
            message += await performAutoScrape();
          }

          if (options.notify) {
            // Add search UI link if APP_URL is set
            const appUrl = process.env.APP_URL;
            if (appUrl) {
              message += `\n\n🔍 Search results: ${appUrl}`;
            }
            console.log('\n🔔 Site came back up! Sending notification...');
            await sendNotification(
              { twilio: config.twilio, notifyWhatsapp: config.notifyWhatsapp },
              message
            );
          }
        }
      };

      // Run immediately
      await runCheck();

      // Then schedule
      const intervalMinutes = Math.max(1, Math.round(config.pollIntervalMs / 60000));
      cron.schedule(`*/${intervalMinutes} * * * *`, runCheck);

      // Keep process running
      process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping monitor...');
        process.exit(0);
      });
    } else {
      // Single check mode (for Render cron jobs)
      const result = await monitor(config.targetUrl);
      let message = formatStatusMessage(result, config.targetUrl);
      console.log(message);

      if (result.wentUp) {
        // Auto-scrape if enabled
        if (options.autoScrape) {
          message += await performAutoScrape();
        }

        // Add search UI link if APP_URL is set
        const appUrl = process.env.APP_URL;
        if (appUrl) {
          message += `\n\n🔍 Search results: ${appUrl}`;
        }

        console.log('\n🔔 Site came back up! Sending notification...');
        await sendNotification(
          { twilio: config.twilio, notifyWhatsapp: config.notifyWhatsapp },
          message
        );
      } else if (result.stateChanged) {
        console.log('\n📝 Status changed, notification sent.');
        await sendNotification(
          { twilio: config.twilio, notifyWhatsapp: config.notifyWhatsapp },
          message
        );
      }
    }
  });

// Scrape command
program
  .command('scrape')
  .description('Scrape all results from the page')
  .action(async () => {
    const config = getConfig();

    try {
      const data = await scrapeAllResults(config.targetUrl);
      await saveResults(data);

      console.log(`\n✅ Scraping complete!`);
      console.log(`   Half Marathon: ${data.categories.halfMarathon.length} results`);
      console.log(`   10km: ${data.categories.tenKm.length} results`);
      console.log(`   Saved to: ${getResultsFilePath('dcs')}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`\n❌ Scraping failed: ${errorMessage}`);
      console.log('   The site may be down or the page structure may have changed.');
    }
  });

// Scrape EvoChip command
program
  .command('scrape:evochip')
  .description('Scrape results from evochip.hu alternative site')
  .option('-u, --url <url>', 'EvoChip results URL', 'https://evochip.hu/results/result.php?distance=hm&category=none&timepoint=none&eventid=DubaiCreekHalf26DAd&year=&lang=en&css=evochip.css&iframe=0&mobile=0&viewport=device-width')
  .action(async (options) => {
    const evoChipUrl = options.url || process.env.EVOCHIP_URL || 'https://evochip.hu/results/result.php?distance=hm&category=none&timepoint=none&eventid=DubaiCreekHalf26DAd&year=&lang=en&css=evochip.css&iframe=0&mobile=0&viewport=device-width';

    try {
      console.log(`\n📥 Scraping EvoChip results from: ${evoChipUrl}\n`);
      const data = await scrapeEvoChipResults(evoChipUrl);
      await saveResults(data, 'dcs');

      console.log(`\n✅ EvoChip scraping complete!`);
      console.log(`   Half Marathon: ${data.categories.halfMarathon.length} results`);
      console.log(`   10km: ${data.categories.tenKm.length} results`);
      console.log(`   Saved to: ${getResultsFilePath('dcs')}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`\n❌ EvoChip scraping failed: ${errorMessage}`);
      console.log('   The site may be down or the page structure may have changed.');
      process.exit(1);
    }
  });

// Search command
program
  .command('search <names...>')
  .description('Search for participants by name (fuzzy search)')
  .option('-r, --race <type>', 'Filter by race type: half, 10k, or all', 'all')
  .action(async (names: string[], options) => {
    // Handle comma-separated names
    const allNames = names.flatMap(n => n.split(',').map(s => s.trim()));

    let raceType: 'halfMarathon' | 'tenKm' | 'all' = 'all';
    if (options.race === 'half') raceType = 'halfMarathon';
    if (options.race === '10k') raceType = 'tenKm';

    const data = await loadResults();
    if (!data) {
      console.log('\n❌ No results data found.');
      console.log('   Run "npm run scrape" first to fetch results.');
      return;
    }

    console.log(`\n📊 Searching in ${data.eventName}`);
    console.log(`   Scraped: ${new Date(data.scrapedAt).toLocaleString()}`);
    console.log(`   Filter: ${raceType === 'all' ? 'All races' : raceType === 'halfMarathon' ? 'Half Marathon' : '10km'}`);

    for (const name of allNames) {
      const results = searchByName(data, name, raceType);
      console.log(formatSearchResults(results, name));
    }
  });

// Test notification command
program
  .command('test-notify')
  .description('Send a test WhatsApp notification')
  .action(async () => {
    const config = getConfig();

    if (!isTwilioConfigured(config.twilio)) {
      console.log('\n❌ Twilio not configured.');
      console.log('   Set these environment variables in .env:');
      console.log('   - TWILIO_ACCOUNT_SID');
      console.log('   - TWILIO_AUTH_TOKEN');
      console.log('   - TWILIO_WHATSAPP_FROM');
      console.log('   - NOTIFY_WHATSAPP');
      return;
    }

    console.log('\n📱 Sending test WhatsApp message...');
    const success = await sendNotification(
      { twilio: config.twilio, notifyWhatsapp: config.notifyWhatsapp },
      '🧪 Test message from HopaChecker!\n\nYour notifications are working correctly.'
    );

    if (success) {
      console.log('✅ Test message sent successfully!');
    }
  });

program.parse();
