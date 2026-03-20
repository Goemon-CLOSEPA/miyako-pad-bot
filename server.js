require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

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

client.once('ready', () => {
    console.log(`🤖 Discord Bot is ready! Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'link') {
        let rawInput = interaction.options.getString('order_id');
        // 入力された文字から「#」や空白を消す
        const orderId = rawInput.replace(/[#＃]/g, '').trim();
        const discordId = interaction.user.id;

        try {
            // 🛡️ 鉄壁チェック1：ホワイトリスト（valid_orders）に存在するか確認
            const { data: validOrder } = await supabase
                .from('valid_orders')
                .select('order_id')
                .eq('order_id', orderId)
                .single();

            if (!validOrder) {
                console.log(`⚠️ 不正アクセス防止: 存在しないID[${orderId}]の入力がありました。`);
                return interaction.reply({ content: `❌ 無効なサブスクIDです。購入履歴が確認できないか、入力が間違っています。`, ephemeral: true });
            }

            // 🛡️ 鉄壁チェック2：既に他の人が使っていないか確認
            const { data: existingLink } = await supabase
                .from('links')
                .select('discord_id')
                .eq('order_id', orderId)
                .single();

            if (existingLink && existingLink.discord_id !== discordId) {
                console.log(`⚠️ 不正利用防止: ID[${orderId}] は既に別のユーザーが使用しています。`);
                return interaction.reply({ content: `❌ このサブスクIDは、既に別のDiscordアカウントに紐付けられています。`, ephemeral: true });
            }

            // チェック通過！保存してロール付与
            const { error: dbError } = await supabase
                .from('links')
                .upsert({ order_id: orderId, discord_id: discordId }, { onConflict: 'order_id' });
            
            if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);

            const member = await interaction.guild.members.fetch(discordId);
            await member.roles.add(ROLE_ID);
            
            console.log(`✅ [コマンド受付]: 入力[${rawInput}] -> ユーザー[${interaction.user.tag}] に紐づけ＆ロール付与完了`);
            await interaction.reply({ content: `✅ サブスクID **${orderId}** を照合し、「サブスク」ロールを付与しました！`, ephemeral: true });
        } catch (error) {
            console.error('❌ エラー:', error.message);
            await interaction.reply({ content: `❌ 処理に失敗しました。管理者に連絡してください。`, ephemeral: true });
        }
    }
});

app.use(express.json());

// ▼ 新規追加：「購入された時」の通知を受け取る窓口 ▼
app.post('/webhook/appstle-create', async (req, res) => {
    res.status(200).send('Webhook Received');
    const rawOrderId = req.body.order_id;
    if (!rawOrderId) return;

    // 長いURL（gid://...）で来ても、最後の数字だけを綺麗に抜き取る
    const orderId = String(rawOrderId).split('/').pop().replace(/[#＃]/g, '').trim();

    // ホワイトリスト（valid_orders）にIDを追加
    const { error } = await supabase.from('valid_orders').upsert({ order_id: orderId }, { onConflict: 'order_id' });
    
    if (error) {
        console.error('❌ ホワイトリスト登録エラー:', error.message);
    } else {
        console.log(`✨ [新規サブスク購入]: ID[${orderId}] をホワイトリストに登録しました！`);
    }
});

// ▼ 既存：「解約された時」の通知を受け取る窓口 ▼
app.post('/webhook/appstle', async (req, res) => {
    res.status(200).send('Webhook Received');
    console.log('\n======= [Webhook Request: Cancel] =======');
    
    const rawOrderId = req.body.order_id; 
    if (!rawOrderId) return;

    // 長いURL（gid://...）で来ても、最後の数字だけを綺麗に抜き取る
    const orderId = String(rawOrderId).split('/').pop().replace(/[#＃]/g, '').trim();

    try {
        const { data } = await supabase.from('links').select('discord_id').eq('order_id', orderId).single();

        if (data) {
            const discordId = data.discord_id;
            const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
            
            if (guild) {
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (member) {
                    await member.roles.remove(ROLE_ID);
                    console.log(`🗑️ [剥奪成功]: ユーザー[${member.user.tag}] からロールを外しました。`);
                }
            }
            // 紐付けデータ（links）から削除
            await supabase.from('links').delete().eq('order_id', orderId);
        }

        // 🛡️ ホワイトリスト（valid_orders）からも完全に削除する
        await supabase.from('valid_orders').delete().eq('order_id', orderId);
        console.log(`🗑️ データベースからサブスクID[${orderId}]の記録を完全に消去しました。\n`);

    } catch (error) {
        console.error('❌ Discord APIエラー:', error.message);
    }
});

// 起動
app.listen(PORT, () => {
    console.log(`🚀 Web Server is running on http://localhost:${PORT}`);
    if (DISCORD_BOT_TOKEN) {
        client.login(DISCORD_BOT_TOKEN).catch(err => console.error('❌ Login Error:', err.message));
    }
});