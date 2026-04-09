const constants = require('./constants');

const { fgCyan, fgGreen, fgYellow, fgMagenta, reset } = constants.COLOR;


const banner = [
    `${fgCyan}$$\\      $$\\                     $$\\        $$$$$$\\  $$$$$$$\\ $$$$$$\\ ${reset}`,
    `${fgCyan}$$$\\    $$$ |                    $$ |      $$  __$$\\ $$  __$$\\\\_$$  _|${reset}`,
    `${fgCyan}$$$$\\  $$$$ | $$$$$$\\   $$$$$$$\\ $$ |  $$\\ $$ /  $$ |$$ |  $$ | $$ |  ${reset}`,
    `${fgGreen}$$\\$$\\$$ $$ |$$  __$$\\ $$  _____|$$ | $$  |$$$$$$$$ |$$$$$$$  | $$ |  ${reset}`,
    `${fgGreen}$$ \\$$$  $$ |$$ /  $$ |$$ /      $$$$$$  / $$  __$$ |$$  ____/  $$ |  ${reset}`,
    `${fgGreen}$$ |\\$  /$$ |$$ |  $$ |$$ |      $$  _$$<  $$ |  $$ |$$ |       $$ |  ${reset}`,
    `${fgMagenta}$$ | \\_/ $$ |\\$$$$$$  |\\$$$$$$$\\ $$ | \\$$\\ $$ |  $$ |$$ |     $$$$$$\\ ${reset}`,
    `${fgMagenta}\\__|     \\__| \\______/  \\_______|\\__|  \\__|\\__|  \\__|\\__|     \\______|${reset}`,
];

const display = () => {
    banner.forEach(line => console.log(line));
    console.log('');
};

module.exports = { display };
