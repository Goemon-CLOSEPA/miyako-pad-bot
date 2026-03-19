require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ▼ 見えない空白や改行を自動で削除する安全装置(.trim)を追加 ▼
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.trim() : null;
const GUILD_ID = process.env.GUILD_ID ? process.env.GUILD_ID.trim() : null;
const ROLE_ID = process.env.ROLE_ID ? process.env.ROLE_ID.trim() : null;
const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : null;
const SUPABASE_KEY = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : null;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ エラー: .env に SUPABASE_URL または SUPABASE_KEY がありません。');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ▼▼▼ 究極の探偵コード：Botの脳内の声をすべて出力 ▼▼▼
client.on('debug', info => console.log(`[🤖 Botの脳内]: ${info}`));
client.on('error', error => console.error(`[🚨 致命的エラー]:`, error));
// ▲▲▲ これでどこでフリーズしているか100%分かります ▲▲▲

client.once('ready', () => {
    console.log(`🤖 Discord Bot is ready! Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'link') {
        const orderId = interaction.options.getString('order_id').trim();
        const discordId = interaction.user.id;

        try {
            const { error: dbError } = await supabase
                .from('links')
                .upsert({ order_id: orderId, discord_id: discordId }, { onConflict: 'order_id' });
            
            if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);

            const member = await interaction.guild.members.fetch(discordId);
            await member.roles.add(ROLE_ID);
            
            console.log(`✅ [コマンド受付]: 注文番号[${orderId}] -> ユーザー[${interaction.user.tag}] に紐づけ＆ロール付与完了`);
            await interaction.reply({ content: `✅ 注文番号 **${orderId}** を照合し、「サブスク」ロールを付与しました！`, ephemeral: true });
        } catch (error) {
            console.error('❌ エラー:', error.message);
            await interaction.reply({ content: `❌ 処理に失敗しました。管理者に連絡してください。`, ephemeral: true });
        }
    }
});

app.use(express.json());

app.post('/webhook/appstle', async (req, res) => {
    res.status(200).send('Webhook Received');
    console.log('\n======= [Webhook Request: Cancel] =======');
    const orderId = req.body.order_id; 

    if (!orderId) {
        console.log('⚠️ エラー: JSON内に `order_id` が見つかりませんでした。剥奪処理をスキップします。\n');
        return;
    }

    try {
        const { data, error: fetchError } = await supabase
            .from('links')
            .select('discord_id')
            .eq('order_id', orderId)
            .single();

        if (fetchError || !data) {
            console.log(`⚠️ エラー: 注文番号[${orderId}] のデータが見つかりません。\n`);
            return;
        }

        const discordId = data.discord_id;
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
        
        if (guild) {
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (member) {
                await member.roles.remove(ROLE_ID);
                console.log(`🗑️ [剥奪成功]: 注文番号[${orderId}] のキャンセル通知により、ユーザー[${member.user.tag}] からロールを外しました。\n`);
                
                const { error: deleteError } = await supabase
                    .from('links')
                    .delete()
                    .eq('order_id', orderId);
                    
                if (!deleteError) {
                    console.log(`🗑️ データベースから注文番号[${orderId}]の記録を削除しました。`);
                }
            } else {
                console.log(`⚠️ ユーザーがサーバーから退出している可能性があります。(ID: ${discordId})\n`);
            }
        }
    } catch (error) {
        console.error('❌ Discord APIエラー:', error.message);
    }
    console.log('==========================================\n');
});

// 起動
app.listen(PORT, () => {
    console.log(`🚀 Web Server is running on http://localhost:${PORT}`);
    
    console.log(`🔍 【最終探偵報告】`);
    console.log(`1. Discordトークン: ${DISCORD_BOT_TOKEN ? '👀文字列あり(空白除去済)' : '🙈空っぽ'}`);
    
    if (DISCORD_BOT_TOKEN) {
        console.log('⏳ Discordへ接続のドアを叩きます...');
        client.login(DISCORD_BOT_TOKEN)
            .then(() => console.log('✅ ドアが開きました（ログイン処理通過）'))
            .catch(err => console.error('❌ ドアが開きません（Login Error）:', err.message));
    }
});
