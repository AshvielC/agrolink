const User = require('../models/User');
const Message = require('../models/Message');
const { createNotification } = require('./notificationService');

function displayName(user) {
  if (!user) return 'User';
  if (user.role === 'farmer') return user.farmerProfile?.farmName || user.name || 'Farmer';
  if (user.role === 'buyer') return user.buyerProfile?.organization || user.name || 'Buyer';
  return user.name || 'Admin';
}

function snapshotUser(user) {
  return {
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || '',
    farmName: user?.farmerProfile?.farmName || '',
    organization: user?.buyerProfile?.organization || ''
  };
}

async function createUserMessage({ senderId, recipientId, subject, body, messageType = 'general', relatedProduct = null, relatedOrder = null, parentMessage = null, productSnapshot = {}, orderSnapshot = {} }) {
  const [sender, recipient] = await Promise.all([
    User.findById(senderId).lean(),
    User.findById(recipientId).lean()
  ]);

  if (!sender || !recipient) {
    throw new Error('Sender or recipient could not be found.');
  }

  if (String(sender._id) === String(recipient._id)) {
    throw new Error('You cannot send a message to yourself.');
  }

  if (recipient.accountStatus === 'suspended') {
    throw new Error('This user is currently suspended and cannot receive messages.');
  }

  const message = await Message.create({
    sender: sender._id,
    recipient: recipient._id,
    senderRole: sender.role,
    recipientRole: recipient.role,
    subject,
    body,
    messageType,
    relatedProduct,
    relatedOrder,
    parentMessage,
    senderSnapshot: snapshotUser(sender),
    recipientSnapshot: snapshotUser(recipient),
    productSnapshot,
    orderSnapshot,
    emailStatus: 'skipped',
    emailError: ''
  });

  await createNotification({
    recipient: recipient._id,
    actor: sender._id,
    actorRole: sender.role,
    title: 'New message received',
    message: `${displayName(sender)} sent you a message: ${subject}`,
    link: `/dashboard/messages/${message._id}`
  });

  return message;
}

module.exports = {
  createUserMessage,
  displayName,
  snapshotUser
};
