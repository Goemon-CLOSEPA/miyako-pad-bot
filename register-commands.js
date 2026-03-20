require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID; // Discord Developer Portalで取得するBotのアプリーケーションID
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error('❌ エラー: .env ファイルに DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID がすべて設定されているか確認してください。');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Shopifyの注文番号とDiscordアカウントを連携し、サブスクロールを付与します。')
        .addStringOption(option =>
            option.setName('order_id')
                .setDescription('購入時の注文番号またはサブスクID（例: 1001）')
                .setRequired(true)
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log(`⏳ コマンドの登録を開始します...`);

        // 単一のサーバー（Miyako Pad）に登録（即時反映されます）
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log(`✅ 成功: ${data.length} 個のスラッシュコマンド（/link）を対象サーバーに登録しました！`);
    } catch (error) {
        console.error('❌ コマンド登録エラー:', error);
    }
})();
