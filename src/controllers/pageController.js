function home(req, res) {
  res.render('pages/home', {
    title: 'Connect farmers and buyers directly'
  });
}

function contact(req, res) {
  res.render('pages/contact', {
    title: 'Contact us'
  });
}

module.exports = {
  home,
  contact
};
